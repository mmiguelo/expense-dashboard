-- Every transaction belongs to an account, and two new types never count as income or
-- spending:
-- * transfer: money moving between two of the user's accounts (account_id -> to_account_id).
--   to_amount is what arrived; the same as amount until accounts can have other currencies.
-- * adjustment: corrects an account's balance (signed amount), e.g. for a forgotten entry.
-- An expense with a negative amount is money back (a refund or a reimbursement).
-- reimbursable marks a purchase someone else will pay back. deleted_at soft-deletes.
--
-- The 'savings' type (money moved to savings, with no account) becomes a transfer from the
-- user's first account to a savings account named 'Poupança', created for it.

alter table public.transactions
  add column account_id uuid,
  add column to_account_id uuid,
  add column to_amount numeric(12, 2),
  add column reimbursable boolean not null default false,
  add column deleted_at timestamptz;

alter table public.accounts add column source_id text;
create unique index accounts_user_id_origin_key on public.accounts (user_id, coalesce(source_id, id::text));

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

/** The user's first account that isn't soft-deleted; creates the default one if needed. */
create function private.default_account(uid uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc uuid;
begin
  select id into acc from public.accounts where user_id = uid and deleted_at is null order by seq limit 1;
  if acc is null then
    perform private.create_default_account(uid, current_date);
    select id into acc from public.accounts where user_id = uid and deleted_at is null order by seq limit 1;
  end if;
  return acc;
end;
$$;

revoke all on function private.default_account(uuid) from public, anon, authenticated;

do $$
declare
  u record;
  savings uuid;
begin
  perform set_config('app.bulk_write', 'on', true);
  update public.transactions t set account_id = private.default_account(t.user_id) where account_id is null;
  for u in
    select user_id, min(date) as first from public.transactions where type = 'savings' group by user_id
  loop
    insert into public.accounts (user_id, name, kind, currency, opening_date)
    select u.user_id, 'Poupança', 'savings', p.currency, u.first from public.profiles p where p.id = u.user_id
    returning id into savings;
    update public.transactions
    set type = 'transfer', to_account_id = savings, to_amount = amount, category = null, subcategory = ''
    where user_id = u.user_id and type = 'savings';
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

alter table public.transactions
  alter column account_id set not null,
  alter column category drop not null,
  add foreign key (account_id, user_id) references public.accounts (id, user_id),
  add foreign key (to_account_id, user_id) references public.accounts (id, user_id),
  drop constraint transactions_type_check,
  add constraint transactions_type_check check (type in ('expense', 'income', 'transfer', 'adjustment')),
  drop constraint transactions_amount_check,
  add constraint transactions_amount_check check (
    case when type in ('income', 'transfer') then amount > 0 else amount <> 0 end),
  add constraint transactions_transfer_check check (
    case when type = 'transfer'
      then to_account_id is not null and to_account_id <> account_id and to_amount > 0
      else to_account_id is null and to_amount is null end),
  -- Income and expenses have a category; transfers and adjustments don't.
  add constraint transactions_category_kind_check check ((type in ('expense', 'income')) = (category is not null)),
  add constraint transactions_reimbursable_check check (not reimbursable or (type = 'expense' and amount > 0));

create index transactions_account_idx on public.transactions (account_id);
create index transactions_to_account_idx on public.transactions (to_account_id) where to_account_id is not null;

-- Inserts without an account (older app versions, recurring generation, imports of old
-- backups) go to the user's first account.
create function private.transactions_default_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_id is null then
    new.account_id := private.default_account(new.user_id);
  end if;
  return new;
end;
$$;

create trigger transactions_default_account before insert on public.transactions
  for each row execute function private.transactions_default_account();

-- ---------------------------------------------------------------------------
-- Import: accounts first, then transactions that refer to them by their original id
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

  insert into public.categories (name, color)
  select e ->> 'name', e ->> 'color'
  from jsonb_array_elements(coalesce(payload -> 'categories', '[]')) with ordinality as t(e, ord)
  order by ord
  on conflict do nothing;
  get diagnostics n = row_count;
  result := result || jsonb_build_object('categories', n);

  -- Income needs its category, even when the backup doesn't list it.
  insert into public.categories (name, color)
  select name, color from public.default_categories where name = 'Rendimentos'
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

  insert into public.recurring_expenses (source_id, description, amount, category, subcategory, day, start_month)
  select e ->> 'source_id', e ->> 'description', (e ->> 'amount')::numeric, e ->> 'category',
    coalesce(e ->> 'subcategory', ''), (e ->> 'day')::smallint, (e ->> 'start_month')::date
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

  return result;
end;
$$;
