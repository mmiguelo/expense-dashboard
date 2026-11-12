-- Money back settles purchases: a repayment (an expense with a negative amount: a refund
-- or a reimbursement) can settle part or all of one or more purchases, and a purchase can
-- be settled by several repayments. Each link says how much of the repayment went to the
-- purchase, so "owed to you" (reimbursable purchases minus what settled them) stays right
-- with partial and grouped repayments.

alter table public.transactions add constraint transactions_id_user_id_key unique (id, user_id);

create table public.transaction_links (
  repayment_id uuid not null,
  purchase_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  primary key (repayment_id, purchase_id),
  check (repayment_id <> purchase_id),
  foreign key (repayment_id, user_id) references public.transactions (id, user_id) on delete cascade,
  foreign key (purchase_id, user_id) references public.transactions (id, user_id) on delete cascade
);

create index transaction_links_purchase_idx on public.transaction_links (purchase_id);

alter table public.transaction_links enable row level security;

create policy "Active users can read their transaction links" on public.transaction_links
  for select to authenticated using ((select auth.uid()) = user_id and (select public.is_active_user()));
create policy "Active users can add their transaction links" on public.transaction_links
  for insert to authenticated with check ((select auth.uid()) = user_id and (select public.is_active_user()));
create policy "Active users can change their transaction links" on public.transaction_links
  for update to authenticated
  using ((select auth.uid()) = user_id and (select public.is_active_user()))
  with check ((select auth.uid()) = user_id and (select public.is_active_user()));
create policy "Active users can delete their transaction links" on public.transaction_links
  for delete to authenticated using ((select auth.uid()) = user_id and (select public.is_active_user()));

grant select, insert, update, delete on public.transaction_links to authenticated;

create trigger enforce_write_limits after insert on public.transaction_links
  referencing new table as new_rows for each statement execute function private.enforce_write_limits('50000');

-- The repayment must be money back and the purchase a positive expense, and no side can
-- be settled for more than its amount. Checked at the end of the transaction, so a
-- repayment's links can be replaced in one go.
create function private.check_transaction_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.transactions;
  p public.transactions;
begin
  if tg_op = 'DELETE' then
    return null;
  end if;
  select * into r from public.transactions where id = new.repayment_id;
  select * into p from public.transactions where id = new.purchase_id;
  if r.type <> 'expense' or r.amount >= 0 then
    raise exception 'Only money back (a negative expense) can settle a purchase.' using errcode = '23514';
  end if;
  if p.type <> 'expense' or p.amount <= 0 then
    raise exception 'Only a purchase (a positive expense) can be settled.' using errcode = '23514';
  end if;
  if (select sum(amount) from public.transaction_links where repayment_id = r.id) > -r.amount then
    raise exception 'The purchases settled add up to more than the money back.' using errcode = '23514';
  end if;
  if (select sum(amount) from public.transaction_links where purchase_id = p.id) > p.amount then
    raise exception 'This purchase would be settled for more than it cost.' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger check_transaction_links after insert or update on public.transaction_links
  deferrable initially deferred
  for each row execute function private.check_transaction_links();

/**
 * Replace what a repayment settles: items is [{purchase_id, amount}]. One call, so the
 * links never end up half-changed.
 */
create function public.set_transaction_links(repayment uuid, items jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.transaction_links where repayment_id = repayment;
  insert into public.transaction_links (repayment_id, purchase_id, amount)
  select repayment, (e ->> 'purchase_id')::uuid, (e ->> 'amount')::numeric
  from jsonb_array_elements(coalesce(items, '[]')) as t(e);
end;
$$;

revoke all on function public.set_transaction_links(uuid, jsonb) from public, anon;
grant execute on function public.set_transaction_links(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Import: links too
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
