-- Recurring entries can be income or transfers too (salary, the monthly meal card
-- load, the monthly move to savings), each on an account. account_id null (rules from
-- before accounts) means the user's first account.

alter table public.recurring_expenses
  add column type text not null default 'expense' check (type in ('expense', 'income', 'transfer')),
  add column account_id uuid,
  add column to_account_id uuid,
  add column reimbursable boolean not null default false,
  alter column category drop not null,
  add foreign key (account_id, user_id) references public.accounts (id, user_id),
  add foreign key (to_account_id, user_id) references public.accounts (id, user_id),
  add constraint recurring_transfer_check check (
    case when type = 'transfer'
      then to_account_id is not null and to_account_id is distinct from account_id and category is null
      else to_account_id is null and category is not null end),
  add constraint recurring_reimbursable_check check (not reimbursable or type = 'expense');

-- Generated transactions take their type, accounts and category from the rule.
create or replace function public.add_recurring_occurrences(items jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
  r public.recurring_expenses;
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
    select * into r from public.recurring_expenses where id = (item ->> 'recurring_id')::uuid;
    if not found then
      continue;
    end if;

    insert into public.recurring_occurrences (recurring_id, month)
    values (r.id, (item ->> 'month')::date)
    on conflict do nothing;

    if found then
      insert into public.transactions (id, date, amount, type, category, subcategory, description, tags, fixed, recurring_id,
        account_id, to_account_id, to_amount, reimbursable)
      values (
        (item ->> 'id')::uuid,
        (item ->> 'date')::date,
        r.amount,
        r.type,
        r.category,
        case when r.type = 'transfer' then '' else r.subcategory end,
        r.description,
        'recurring',
        true,
        r.id,
        r.account_id,
        r.to_account_id,
        case when r.type = 'transfer' then r.amount end,
        r.reimbursable
      );
      created := created + 1;
    end if;
  end loop;
  return created;
end;
$$;

-- ---------------------------------------------------------------------------
-- Import: recurring entries with their type and accounts
-- ---------------------------------------------------------------------------

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
    if payload ? 'subcategories' then delete from public.subcategories where user_id = uid; end if;
    if payload ? 'categories' then delete from public.categories where user_id = uid; end if;
    if payload ? 'corrections' then delete from public.category_corrections where user_id = uid; end if;
    if payload ? 'keyword_rules' then delete from public.keyword_rules where user_id = uid; end if;
    -- Accounts can only go once nothing refers to them.
    if payload ? 'accounts' and payload ? 'transactions' then delete from public.accounts where user_id = uid; end if;
  end if;

  insert into public.accounts (source_id, name, kind, currency, opening_balance, opening_date, institution, archived, deleted_at)
  select e ->> 'source_id', e ->> 'name', e ->> 'kind', coalesce(e ->> 'currency', p.currency),
    coalesce((e ->> 'opening_balance')::numeric, 0), coalesce((e ->> 'opening_date')::date, current_date),
    coalesce(e ->> 'institution', ''), coalesce((e ->> 'archived')::boolean, false), (e ->> 'deleted_at')::timestamptz
  from jsonb_array_elements(coalesce(payload -> 'accounts', '[]')) with ordinality as t(e, ord)
  cross join public.profiles p
  where p.id = uid
    and not exists (select 1 from public.accounts a where a.user_id = uid and a.id::text = e ->> 'source_id')
  order by ord
  on conflict do nothing;
  get diagnostics n = row_count;
  result := result || jsonb_build_object('accounts', n);

  insert into public.categories (name, color, kind)
  select e ->> 'name', e ->> 'color',
    coalesce(e ->> 'kind', case when e ->> 'name' in ('Rendimentos', 'Income') then 'income' else 'expense' end)
  from jsonb_array_elements(coalesce(payload -> 'categories', '[]')) with ordinality as t(e, ord)
  order by ord
  on conflict do nothing;
  get diagnostics n = row_count;
  result := result || jsonb_build_object('categories', n);

  -- Income needs a category, even when the backup doesn't list one.
  insert into public.categories (name, color, kind)
  select name, color, 'income' from public.default_categories where name = 'Rendimentos'
    and not exists (select 1 from public.categories where user_id = uid and kind = 'income')
  on conflict do nothing;

  insert into public.subcategories (category, name)
  select e ->> 'category', e ->> 'name'
  from jsonb_array_elements(coalesce(payload -> 'subcategories', '[]')) with ordinality as t(e, ord)
  where exists (select 1 from public.categories c where c.user_id = uid and c.name = e ->> 'category')
  order by ord
  on conflict do nothing;
  get diagnostics n = row_count;
  result := result || jsonb_build_object('subcategories', n);

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

  insert into public.recurring_expenses (source_id, description, amount, category, subcategory, day, start_month,
    type, account_id, to_account_id, reimbursable)
  select e ->> 'source_id', e ->> 'description', (e ->> 'amount')::numeric, e ->> 'category',
    coalesce(e ->> 'subcategory', ''), (e ->> 'day')::smallint, (e ->> 'start_month')::date,
    coalesce(e ->> 'type', 'expense'),
    (select a.id from public.accounts a where a.user_id = uid and e ->> 'account' in (a.id::text, a.source_id) limit 1),
    (select a.id from public.accounts a where a.user_id = uid and e ->> 'to_account' in (a.id::text, a.source_id) limit 1),
    coalesce((e ->> 'reimbursable')::boolean, false)
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

  insert into public.transactions (source_id, date, amount, type, category, subcategory, description, tags, fixed,
    account_id, to_account_id, to_amount, reimbursable, deleted_at)
  select e ->> 'source_id', (e ->> 'date')::date, (e ->> 'amount')::numeric, e ->> 'type', e ->> 'category',
    coalesce(e ->> 'subcategory', ''), coalesce(e ->> 'description', ''), coalesce(e ->> 'tags', ''),
    coalesce((e ->> 'fixed')::boolean, false),
    -- An account from this backup (by its original id) or already this user's; else the trigger's default.
    (select a.id from public.accounts a where a.user_id = uid and e ->> 'account' in (a.id::text, a.source_id) limit 1),
    (select a.id from public.accounts a where a.user_id = uid and e ->> 'to_account' in (a.id::text, a.source_id) limit 1),
    (e ->> 'to_amount')::numeric,
    coalesce((e ->> 'reimbursable')::boolean, false), (e ->> 'deleted_at')::timestamptz
  from jsonb_array_elements(coalesce(payload -> 'transactions', '[]')) with ordinality as t(e, ord)
  order by ord
  on conflict do nothing;
  get diagnostics n = row_count;
  result := result || jsonb_build_object(
    'transactions', n,
    'transactions_skipped', jsonb_array_length(coalesce(payload -> 'transactions', '[]')) - n
  );

  -- Links between money back and the purchases it settles, by the transactions' original ids.
  insert into public.transaction_links (repayment_id, purchase_id, amount)
  select r.id, p.id, (e ->> 'amount')::numeric
  from jsonb_array_elements(coalesce(payload -> 'links', '[]')) as t(e)
  join public.transactions r on r.user_id = uid and e ->> 'repayment' in (r.id::text, r.source_id)
  join public.transactions p on p.user_id = uid and e ->> 'purchase' in (p.id::text, p.source_id)
  on conflict do nothing;
  get diagnostics n = row_count;
  result := result || jsonb_build_object('links', n);

  return result;
end;
$$;
