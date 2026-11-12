-- Categories have a kind: expense or income. Users can create, rename and delete income
-- categories like expense ones; 'Rendimentos' is no longer reserved, just the income
-- category everyone starts with. A category's kind never changes (that would move money
-- between income and spending in past reports): make a new one and move the entries.
--
-- Defaults for new users drop what are now transfers ('Investimentos', 'Movimentos ›
-- Transferências'), turn cash withdrawals into a 'Dinheiro' expense category, move taxes
-- out of income, and add 'Benefícios' and 'Juros' to income.

alter table public.categories add column kind text not null default 'expense' check (kind in ('expense', 'income'));
alter table public.default_categories add column kind text not null default 'expense' check (kind in ('expense', 'income'));
update public.categories set kind = 'income' where name in ('Rendimentos', 'Income');
update public.default_categories set kind = 'income' where name = 'Rendimentos';

-- ---------------------------------------------------------------------------
-- Defaults for new users (existing users keep their own categories)
-- ---------------------------------------------------------------------------

update public.default_categories set name = 'Dinheiro' where name = 'Movimentos';
delete from public.default_subcategories where category = 'Dinheiro';
delete from public.default_keyword_rules where category = 'Investimentos';
delete from public.default_subcategories where category = 'Investimentos';
delete from public.default_categories where name = 'Investimentos';
delete from public.default_subcategories where category = 'Rendimentos' and name = 'Taxas & Impostos';
insert into public.default_subcategories (category, name, sort_order)
select 'Rendimentos', n, o from (values ('Benefícios', 5), ('Juros', 25)) as v(n, o)
where not exists (select 1 from public.default_subcategories where category = 'Rendimentos' and name = v.n);

create or replace function private.copy_defaults(uid uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (user_id, name, color, kind)
  select uid, name, color, kind from public.default_categories order by sort_order, id
  on conflict do nothing;

  insert into public.subcategories (user_id, category, name)
  select uid, s.category, s.name
  from public.default_subcategories s
  join public.default_categories c on c.name = s.category
  order by c.sort_order, c.id, s.sort_order, s.id
  on conflict do nothing;

  insert into public.keyword_rules (user_id, keyword, category)
  select uid, r.keyword, r.category
  from public.default_keyword_rules r
  join public.default_categories c on c.name = r.category
  order by c.sort_order, c.id, r.id
  on conflict do nothing;
$$;

-- ---------------------------------------------------------------------------
-- Renaming and deleting work for both kinds
-- ---------------------------------------------------------------------------

create or replace function public.rename_category(old_name text, new_name text)
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
  if new_name = '' or length(new_name) > 100 then
    raise exception 'Choose another name.';
  end if;
  if new_name = old_name then
    return;
  end if;
  if exists (select 1 from public.categories where user_id = uid and name = new_name) then
    raise exception 'There is already a category called "%".', new_name;
  end if;

  -- Its subcategories follow through the foreign key.
  update public.categories set name = new_name where user_id = uid and name = old_name;
  if not found then
    raise exception 'There is no category called "%".', old_name;
  end if;
  update public.transactions set category = new_name where user_id = uid and category = old_name;
  update public.recurring_expenses set category = new_name where user_id = uid and category = old_name;
  update public.keyword_rules set category = new_name where user_id = uid and category = old_name;
  update public.category_corrections set category = new_name where user_id = uid and category = old_name;
  delete from public.budgets where user_id = uid and category = new_name;
  update public.budgets set category = new_name where user_id = uid and category = old_name;
end;
$$;

create or replace function public.delete_category(category_name text, reassign_to text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  k text;
begin
  if not public.is_active_user() then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  select kind into k from public.categories where user_id = uid and name = category_name;
  if k is null then
    raise exception 'There is no category called "%".', category_name;
  end if;
  if not exists (select 1 from public.categories where user_id = uid and kind = k and name <> category_name) then
    raise exception 'This is your last % category; it cannot be deleted.', k;
  end if;
  if reassign_to is not null
     and (reassign_to = category_name
          or not exists (select 1 from public.categories where user_id = uid and name = reassign_to and kind = k)) then
    raise exception 'Choose another existing category to move its transactions to.';
  end if;
  if reassign_to is null and (
       exists (select 1 from public.transactions where user_id = uid and category = category_name)
       or exists (select 1 from public.recurring_expenses where user_id = uid and category = category_name)) then
    raise exception '"%" is still used by transactions or recurring expenses. Choose a category to move them to.', category_name;
  end if;

  if reassign_to is not null then
    update public.transactions set category = reassign_to, subcategory = '' where user_id = uid and category = category_name;
    update public.recurring_expenses set category = reassign_to, subcategory = '' where user_id = uid and category = category_name;
    update public.keyword_rules set category = reassign_to where user_id = uid and category = category_name;
    update public.category_corrections set category = reassign_to where user_id = uid and category = category_name;
  else
    delete from public.keyword_rules where user_id = uid and category = category_name;
    delete from public.category_corrections where user_id = uid and category = category_name;
  end if;
  delete from public.budgets where user_id = uid and category = category_name;
  -- Its subcategories go with it through the foreign key.
  delete from public.categories where user_id = uid and name = category_name;
end;
$$;

-- The kind is fixed once a category exists.
create function private.keep_category_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind <> old.kind then
    raise exception 'A category''s kind cannot change. Create a new category and move the entries.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger keep_category_kind before update on public.categories
  for each row execute function private.keep_category_kind();

-- ---------------------------------------------------------------------------
-- Import: categories with their kind
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
