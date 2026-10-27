-- Abuse protection (per-user write limits), safe category rename/delete, and the bulk
-- functions updated for active accounts and keyword rules.

-- ---------------------------------------------------------------------------
-- Write limits
--
-- Every per-user table has a maximum number of rows per user, and new rows per user are
-- limited to 120 per minute across all tables. The per-minute limit skips:
--   * requests without a signed-in user (SQL Editor, migrations, the sign-up trigger)
--   * the bulk functions below (imports, recurring generation); they are bounded by the
--     per-table maximums and their own size checks instead.
-- Checks run once per statement, so a bulk insert costs one count, not one per row.
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.write_counters (
  user_id uuid not null,
  minute timestamptz not null,
  rows integer not null,
  primary key (user_id, minute)
);

create function private.enforce_write_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_rows constant integer := tg_argv[0]::integer;
  per_minute constant integer := 120;
  owner uuid;
  added integer;
  n integer;
begin
  for owner, added in select user_id, count(*) from new_rows group by user_id loop
    execute format('select count(*) from (select 1 from %I.%I where user_id = $1 limit $2) t', tg_table_schema, tg_table_name)
      into n using owner, max_rows + 1;
    if n > max_rows then
      raise exception 'Limit reached: an account can have at most % rows in %.', max_rows, tg_table_name
        using hint = 'Delete some old entries first.';
    end if;

    if auth.uid() is not null and coalesce(current_setting('app.bulk_write', true), '') <> 'on' then
      insert into private.write_counters (user_id, minute, rows)
      values (owner, date_trunc('minute', clock_timestamp()), added)
      on conflict (user_id, minute) do update set rows = private.write_counters.rows + excluded.rows
      returning rows into n;
      if n > per_minute then
        raise exception 'Too many changes at once: at most % new entries per minute. Wait a minute and try again.', per_minute;
      end if;
      delete from private.write_counters where user_id = owner and minute < date_trunc('minute', clock_timestamp()) - interval '1 hour';
    end if;
  end loop;
  return null;
end;
$$;

create trigger enforce_write_limits after insert on public.transactions
  referencing new table as new_rows for each statement execute function private.enforce_write_limits('50000');
create trigger enforce_write_limits after insert on public.recurring_occurrences
  referencing new table as new_rows for each statement execute function private.enforce_write_limits('20000');
create trigger enforce_write_limits after insert on public.category_corrections
  referencing new table as new_rows for each statement execute function private.enforce_write_limits('5000');
create trigger enforce_write_limits after insert on public.keyword_rules
  referencing new table as new_rows for each statement execute function private.enforce_write_limits('2000');
create trigger enforce_write_limits after insert on public.categories
  referencing new table as new_rows for each statement execute function private.enforce_write_limits('200');
create trigger enforce_write_limits after insert on public.budgets
  referencing new table as new_rows for each statement execute function private.enforce_write_limits('200');
create trigger enforce_write_limits after insert on public.recurring_expenses
  referencing new table as new_rows for each statement execute function private.enforce_write_limits('200');

-- ---------------------------------------------------------------------------
-- Categories: rename and delete, updating everything that refers to them, atomically.
-- ---------------------------------------------------------------------------

create function public.rename_category(old_name text, new_name text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if not public.is_active_user() then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  new_name := trim(new_name);
  if new_name = '' or length(new_name) > 100 or new_name = 'Income' then
    raise exception 'Choose another name.';
  end if;
  if new_name = old_name then
    return;
  end if;
  if exists (select 1 from public.categories where user_id = uid and name = new_name) then
    raise exception 'There is already a category called "%".', new_name;
  end if;

  update public.categories set name = new_name where user_id = uid and name = old_name;
  if not found then
    raise exception 'There is no category called "%".', old_name;
  end if;
  update public.transactions set category = new_name where user_id = uid and category = old_name and type = 'expense';
  update public.recurring_expenses set category = new_name where user_id = uid and category = old_name;
  update public.keyword_rules set category = new_name where user_id = uid and category = old_name;
  update public.category_corrections set category = new_name where user_id = uid and category = old_name;
  -- A budget left over for the new name (from an old category) gives way to this one's.
  delete from public.budgets where user_id = uid and category = new_name;
  update public.budgets set category = new_name where user_id = uid and category = old_name;
end;
$$;

-- Delete a category. Its transactions and recurring expenses move to `reassign_to`,
-- which is required if there are any. Its keyword rules and learned merchants move too,
-- or are deleted when there is nowhere to move them. Its budget is deleted.
create function public.delete_category(category_name text, reassign_to text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if not public.is_active_user() then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.categories where user_id = uid and name = category_name) then
    raise exception 'There is no category called "%".', category_name;
  end if;
  if reassign_to is not null
     and (reassign_to = category_name or not exists (select 1 from public.categories where user_id = uid and name = reassign_to)) then
    raise exception 'Choose another existing category to move its transactions to.';
  end if;
  if reassign_to is null and (
       exists (select 1 from public.transactions where user_id = uid and category = category_name and type = 'expense')
       or exists (select 1 from public.recurring_expenses where user_id = uid and category = category_name)) then
    raise exception '"%" is still used by transactions or recurring expenses. Choose a category to move them to.', category_name;
  end if;

  if reassign_to is not null then
    update public.transactions set category = reassign_to where user_id = uid and category = category_name and type = 'expense';
    update public.recurring_expenses set category = reassign_to where user_id = uid and category = category_name;
    update public.keyword_rules set category = reassign_to where user_id = uid and category = category_name;
    update public.category_corrections set category = reassign_to where user_id = uid and category = category_name;
  else
    delete from public.keyword_rules where user_id = uid and category = category_name;
    delete from public.category_corrections where user_id = uid and category = category_name;
  end if;
  delete from public.budgets where user_id = uid and category = category_name;
  delete from public.categories where user_id = uid and name = category_name;
end;
$$;

revoke execute on function public.rename_category(text, text) from public, anon;
revoke execute on function public.delete_category(text, text) from public, anon;
grant execute on function public.rename_category(text, text) to authenticated;
grant execute on function public.delete_category(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Bulk functions: active accounts only, size-checked, exempt from the per-minute limit.
-- Same behaviour as before otherwise (see 20261027120100_functions.sql).
-- ---------------------------------------------------------------------------

create or replace function public.add_recurring_occurrences(items jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
  created integer := 0;
begin
  if not public.is_active_user() then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if jsonb_array_length(items) > 5000 then
    raise exception 'Too many recurring expenses to generate at once.';
  end if;
  perform set_config('app.bulk_write', 'on', true);

  for item in select * from jsonb_array_elements(items) loop
    if date_trunc('month', (item ->> 'date')::date)::date <> (item ->> 'month')::date then
      raise exception 'date % is not in month %', item ->> 'date', item ->> 'month';
    end if;

    insert into public.recurring_occurrences (recurring_id, month)
    values ((item ->> 'recurring_id')::uuid, (item ->> 'month')::date)
    on conflict do nothing;

    if found then
      insert into public.transactions (id, date, amount, type, category, description, tags, fixed, recurring_id)
      values (
        (item ->> 'id')::uuid,
        (item ->> 'date')::date,
        (item ->> 'amount')::numeric,
        'expense',
        item ->> 'category',
        item ->> 'description',
        'recurring',
        true,
        (item ->> 'recurring_id')::uuid
      );
      created := created + 1;
    end if;
  end loop;
  return created;
end;
$$;

-- Adds `keyword_rules` ([{ "keyword", "category" }]) to the payload; see the original
-- definition for the other keys.
create or replace function public.import_snapshot(payload jsonb, replace_existing boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n integer;
  result jsonb := '{}';
begin
  if uid is null or not public.is_active_user() then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(payload -> 'transactions', '[]')) > 20000 then
    raise exception 'This backup is too large to import at once (at most 20,000 transactions).';
  end if;
  perform set_config('app.bulk_write', 'on', true);

  if replace_existing then
    if payload ? 'transactions' then delete from public.transactions where user_id = uid; end if;
    if payload ? 'recurring' then delete from public.recurring_expenses where user_id = uid; end if;
    if payload ? 'occurrences' then delete from public.recurring_occurrences where user_id = uid; end if;
    if payload ? 'budgets' then delete from public.budgets where user_id = uid; end if;
    if payload ? 'categories' then delete from public.categories where user_id = uid; end if;
    if payload ? 'corrections' then delete from public.category_corrections where user_id = uid; end if;
    if payload ? 'keyword_rules' then delete from public.keyword_rules where user_id = uid; end if;
  end if;

  insert into public.categories (name, color)
  select e ->> 'name', e ->> 'color'
  from jsonb_array_elements(coalesce(payload -> 'categories', '[]')) with ordinality as t(e, ord)
  order by ord
  on conflict do nothing;
  get diagnostics n = row_count;
  result := result || jsonb_build_object('categories', n);

  insert into public.keyword_rules (keyword, category)
  select lower(e ->> 'keyword'), e ->> 'category'
  from jsonb_array_elements(coalesce(payload -> 'keyword_rules', '[]')) with ordinality as t(e, ord)
  order by ord
  on conflict do nothing;
  get diagnostics n = row_count;
  result := result || jsonb_build_object('keyword_rules', n);

  insert into public.budgets (category, amount)
  select e ->> 'category', (e ->> 'amount')::numeric
  from jsonb_array_elements(coalesce(payload -> 'budgets', '[]')) as t(e)
  on conflict do nothing;
  get diagnostics n = row_count;
  result := result || jsonb_build_object('budgets', n);

  insert into public.category_corrections (merchant, category)
  select lower(e ->> 'merchant'), e ->> 'category'
  from jsonb_array_elements(coalesce(payload -> 'corrections', '[]')) as t(e)
  on conflict do nothing;
  get diagnostics n = row_count;
  result := result || jsonb_build_object('corrections', n);

  insert into public.recurring_expenses (source_id, description, amount, category, day, start_month)
  select e ->> 'source_id', e ->> 'description', (e ->> 'amount')::numeric, e ->> 'category',
    (e ->> 'day')::smallint, (e ->> 'start_month')::date
  from jsonb_array_elements(coalesce(payload -> 'recurring', '[]')) with ordinality as t(e, ord)
  order by ord
  on conflict do nothing;
  get diagnostics n = row_count;
  result := result || jsonb_build_object('recurring', n);

  insert into public.recurring_occurrences (recurring_id, month)
  select r.id, (e ->> 'month')::date
  from jsonb_array_elements(coalesce(payload -> 'occurrences', '[]')) as t(e)
  join public.recurring_expenses r
    on r.user_id = uid and coalesce(r.source_id, r.id::text) = e ->> 'recurring_source_id'
  on conflict do nothing;
  get diagnostics n = row_count;
  result := result || jsonb_build_object('occurrences', n);

  insert into public.transactions (source_id, date, amount, type, category, description, tags, fixed)
  select e ->> 'source_id', (e ->> 'date')::date, (e ->> 'amount')::numeric, e ->> 'type', e ->> 'category',
    coalesce(e ->> 'description', ''), coalesce(e ->> 'tags', ''), coalesce((e ->> 'fixed')::boolean, false)
  from jsonb_array_elements(coalesce(payload -> 'transactions', '[]')) with ordinality as t(e, ord)
  order by ord
  on conflict do nothing;
  get diagnostics n = row_count;
  result := result || jsonb_build_object(
    'transactions', n,
    'transactions_skipped', jsonb_array_length(coalesce(payload -> 'transactions', '[]')) - n
  );

  return result;
end;
$$;
