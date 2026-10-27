-- Both functions are SECURITY INVOKER (the default): they run as the calling user, so
-- Row Level Security applies to everything they read and write.

-- ---------------------------------------------------------------------------
-- Recurring expenses: record a generated month and insert its transaction together.
--
-- items: [{ "recurring_id", "month": "YYYY-MM-01", "id", "date", "amount", "category", "description" }]
--
-- A month that is already in recurring_occurrences is skipped, so calling this twice
-- (e.g. from two devices at once) generates each month only once. Concurrent calls
-- wait on the primary key and then skip. Returns the number of transactions created.
-- ---------------------------------------------------------------------------
create function public.add_recurring_occurrences(items jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
  created integer := 0;
begin
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

-- ---------------------------------------------------------------------------
-- Import a backup (from localStorage or a JSON file) into the caller's account.
--
-- payload keys, each optional:
--   categories   [{ "name", "color" }]                 in display order
--   budgets      [{ "category", "amount" }]
--   corrections  [{ "merchant", "category" }]
--   recurring    [{ "source_id", "description", "amount", "category", "day", "start_month" }]
--   occurrences  [{ "recurring_source_id", "month" }]  months already generated
--   transactions [{ "source_id", "date", "amount", "type", "category", "description", "tags", "fixed" }]
--
-- replace_existing = false (merge): rows already in the account are kept and matching
--   rows from the payload are skipped: transactions and recurring expenses by original id,
--   categories / budgets / corrections by name. Importing the same data again adds nothing.
-- replace_existing = true: for each key present, the account's rows are deleted first.
--
-- Runs in one transaction: it either all applies or none of it does.
-- Returns counts of inserted rows, e.g. {"transactions": 120, "transactions_skipped": 3, ...}.
-- ---------------------------------------------------------------------------
create function public.import_snapshot(payload jsonb, replace_existing boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n integer;
  result jsonb := '{}';
begin
  if uid is null then
    raise exception 'not signed in';
  end if;

  if replace_existing then
    if payload ? 'transactions' then delete from public.transactions where user_id = uid; end if;
    if payload ? 'recurring' then delete from public.recurring_expenses where user_id = uid; end if;
    if payload ? 'occurrences' then delete from public.recurring_occurrences where user_id = uid; end if;
    if payload ? 'budgets' then delete from public.budgets where user_id = uid; end if;
    if payload ? 'categories' then delete from public.categories where user_id = uid; end if;
    if payload ? 'corrections' then delete from public.category_corrections where user_id = uid; end if;
  end if;

  insert into public.categories (name, color)
  select e ->> 'name', e ->> 'color'
  from jsonb_array_elements(coalesce(payload -> 'categories', '[]')) with ordinality as t(e, ord)
  order by ord
  on conflict do nothing;
  get diagnostics n = row_count;
  result := result || jsonb_build_object('categories', n);

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

  -- Months already generated, matched to the recurring expense by its original id.
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

revoke execute on function public.add_recurring_occurrences(jsonb) from public, anon;
revoke execute on function public.import_snapshot(jsonb, boolean) from public, anon;
grant execute on function public.add_recurring_occurrences(jsonb) to authenticated;
grant execute on function public.import_snapshot(jsonb, boolean) to authenticated;
