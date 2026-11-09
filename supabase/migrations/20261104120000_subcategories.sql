-- Subcategories, and the Portuguese category list (categories.xlsx) as the defaults.
--
-- * Each category has subcategories. A transaction or recurring expense has a category
--   and, optionally, one of that category's subcategories ('' = none).
-- * Income is the category 'Rendimentos' (it used to be the fixed name 'Income'), so
--   income transactions can have a subcategory too (Salário, Vendas, ...).
-- * Accounts that have no transactions and no recurring expenses yet get the new
--   defaults in place of the old ones. Accounts with data keep their categories and
--   just get 'Rendimentos' for their income.

-- ---------------------------------------------------------------------------
-- Columns and tables
-- ---------------------------------------------------------------------------

alter table public.transactions
  add column subcategory text not null default '' check (length(subcategory) <= 100);
alter table public.recurring_expenses
  add column subcategory text not null default '' check (length(subcategory) <= 100);

create table public.default_subcategories (
  id bigint generated always as identity primary key,
  category text not null references public.default_categories (name) on update cascade on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  sort_order integer not null default 0,
  unique (category, name)
);

create table public.subcategories (
  -- Identity order is display order.
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category text not null,
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (user_id, category, name),
  -- Renaming a category renames it here; deleting it deletes its subcategories.
  foreign key (user_id, category) references public.categories (user_id, name) on update cascade on delete cascade
);

create trigger enforce_write_limits after insert on public.subcategories
  referencing new table as new_rows for each statement execute function private.enforce_write_limits('2000');

alter table public.subcategories enable row level security;
alter table public.default_subcategories enable row level security;

create policy "Active users can read their subcategories" on public.subcategories
  for select to authenticated using ((select auth.uid()) = user_id and (select public.is_active_user()));
create policy "Active users can add their subcategories" on public.subcategories
  for insert to authenticated with check ((select auth.uid()) = user_id and (select public.is_active_user()));
create policy "Active users can change their subcategories" on public.subcategories
  for update to authenticated using ((select auth.uid()) = user_id and (select public.is_active_user()))
  with check ((select auth.uid()) = user_id and (select public.is_active_user()));
create policy "Active users can delete their subcategories" on public.subcategories
  for delete to authenticated using ((select auth.uid()) = user_id and (select public.is_active_user()));

create policy "Active users can read default subcategories" on public.default_subcategories
  for select to authenticated using ((select public.is_active_user()));
create policy "Admins can add default subcategories" on public.default_subcategories
  for insert to authenticated with check ((select public.is_admin()));
create policy "Admins can change default subcategories" on public.default_subcategories
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins can delete default subcategories" on public.default_subcategories
  for delete to authenticated using ((select public.is_admin()));

revoke all on public.subcategories, public.default_subcategories from anon;
grant select, insert, update, delete on public.subcategories, public.default_subcategories to authenticated;

-- ---------------------------------------------------------------------------
-- New defaults
-- ---------------------------------------------------------------------------

insert into public.default_categories (name, color, sort_order) values
  ('Alimentação', '#6f7442', 1010),
  ('Crédito', '#7a2e3c', 1020),
  ('Bem-Estar', '#c48b9f', 1030),
  ('Educação', '#4f6d7a', 1040),
  ('Férias', '#d39b5a', 1050),
  ('Habitação', '#8b6b56', 1060),
  ('Lazer', '#b5643c', 1070),
  ('Movimentos', '#a39b8b', 1080),
  ('Investimentos', '#3f6b5b', 1090),
  ('Donativos', '#b07d9c', 1100),
  ('Quotas', '#7c7a52', 1110),
  ('Rendimentos', '#5e8c61', 1120),
  ('Saúde', '#5b8a9a', 1130),
  ('Seguros', '#6c5a7c', 1140),
  ('Subscrições', '#c2a14d', 1150),
  ('Taxas', '#9a4a3a', 1160),
  ('Transportes', '#3e5a73', 1170);

insert into public.default_subcategories (category, name, sort_order)
select category, name, ord::integer * 10
from (values
  ('Alimentação', array['Mercearia', 'Peixaria', 'Supermercado', 'Talho']),
  ('Crédito', array['Automóvel', 'Habitação', 'Juros', 'Pessoal']),
  ('Bem-Estar', array['Barbeiro', 'Cabeleireiro', 'Esteticista', 'Massagista', 'Perfumaria', 'Vestuário']),
  ('Educação', array['Conferências', 'Creche', 'Escola', 'Livros', 'Manuais Escolares', 'Material de Escritório', 'Pós-graduação', 'Propinas']),
  ('Férias', array['Fins-de-semana', 'Neve', 'Retiros', 'Verão']),
  ('Habitação', array['Água', 'Condomínio', 'Electricidade', 'Empregada', 'Esgotos', 'Gás', 'Jardineiro', 'Lavandaria', 'Limpezas', 'Mudanças', 'Obras', 'Recheio', 'Segurança', 'Telemóvel', 'TV Net Voz']),
  ('Lazer', array['Animais', 'Apostas', 'Babysitter', 'Brinquedos', 'Cafetaria', 'Cinema', 'Concertos', 'Copos', 'Discoteca', 'Fotografias', 'Museus', 'Restauração', 'Teatro', 'Tecnologia']),
  ('Movimentos', array['Levantamentos', 'Transferências']),
  ('Investimentos', array['Binance', 'DIF Broker', 'Fundos Optimize', 'Fundo de Emergência', 'Interactive Brokers', 'XTB']),
  ('Donativos', array['Donativos', 'Presentes']),
  ('Quotas', array['Acege', 'Apeergast', 'Camtil']),
  ('Rendimentos', array['Mais-Valias', 'Salário', 'Subsídios', 'Taxas & Impostos', 'Vendas']),
  ('Saúde', array['Análises Clínicas', 'Consultas', 'Desporto', 'Exames Médicos', 'Farmácia', 'Fisioterapia', 'Internamentos', 'Nutricionista', 'Oculista', 'Psicólogo', 'Urgências', 'Vacinas']),
  ('Seguros', array['Carro', 'Mota', 'Multirriscos Recheio', 'Multirriscos Edifício', 'Saúde', 'Vida Habitação', 'Empregada']),
  ('Subscrições', array['Amazon Prime', 'Artificial Intelligence', 'Apple Music', 'Apple One', 'Apple TV+', 'Calm (Mindfulness)', 'Disney+', 'Fnac', 'HBO', 'iCloud', 'LinkedIn Premium', 'Netflix', 'Spotify', 'Uber']),
  ('Taxas', array['Cheques', 'Comissão de cartão', 'Descoberto', 'Estorno Movimentos', 'IMI', 'Imposto de Selo', 'IMT', 'IRS', 'IUC', 'Juros Mais Valias', 'Manutenção de Depósito', 'Multas', 'Registos', 'Segurança Social']),
  ('Transportes', array['Avença', 'Comboio', 'Combustível', 'Inspeção', 'Manutenção', 'Metro', 'TVDE', 'Via Verde'])
) as d(category, names)
cross join lateral unnest(names) with ordinality as u(name, ord);

-- Keep the default keyword rules, pointed at the new categories.
update public.default_keyword_rules set category = case
    when keyword in ('netflix', 'spotify') then 'Subscrições'
    when keyword in ('zara', 'roupa') then 'Bem-Estar'
    when keyword = 'ikea' then 'Habitação'
    else case category
      when 'Groceries' then 'Alimentação'
      when 'Utilities' then 'Habitação'
      when 'Insurance' then 'Seguros'
      when 'Mortgage' then 'Crédito'
      when 'Gym' then 'Saúde'
      when 'Transportation' then 'Transportes'
      when 'Fuel' then 'Transportes'
      when 'Education' then 'Educação'
      when 'Leisure' then 'Lazer'
      when 'Health' then 'Saúde'
      when 'Phone & Internet' then 'Habitação'
      when 'Shopping' then 'Lazer'
      else category
    end
  end
where category in ('Groceries', 'Utilities', 'Insurance', 'Mortgage', 'Gym', 'Transportation', 'Fuel',
                   'Education', 'Leisure', 'Health', 'Phone & Internet', 'Shopping');

-- The old English defaults (their remaining rules go with them).
delete from public.default_categories
where name in ('Groceries', 'Utilities', 'Insurance', 'Mortgage', 'Gym', 'Transportation', 'Fuel',
               'Education', 'Leisure', 'Health', 'Phone & Internet', 'Shopping', 'Other');

update public.default_categories c set sort_order = n.rn * 10
from (select id, row_number() over (order by sort_order, id) as rn from public.default_categories) n
where c.id = n.id;

-- ---------------------------------------------------------------------------
-- Copying the defaults to an account
-- ---------------------------------------------------------------------------

create function private.copy_defaults(uid uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (user_id, name, color)
  select uid, name, color from public.default_categories order by sort_order, id
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

revoke all on function private.copy_defaults(uuid) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bulk text := coalesce(current_setting('app.bulk_write', true), '');
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), split_part(coalesce(new.email, ''), '@', 1));
  -- The defaults (over 100 subcategories) don't count towards the per-minute limit.
  perform set_config('app.bulk_write', 'on', true);
  perform private.copy_defaults(new.id);
  perform set_config('app.bulk_write', bulk, true);
  return new;
end;
$$;

-- Accounts without any transactions or recurring expenses: start over with the new
-- defaults (their categories, subcategories, rules, budgets and learned merchants).
do $$
declare
  uid uuid;
begin
  for uid in
    select u.id from auth.users u
    where not exists (select 1 from public.transactions t where t.user_id = u.id)
      and not exists (select 1 from public.recurring_expenses r where r.user_id = u.id)
  loop
    delete from public.budgets where user_id = uid;
    delete from public.category_corrections where user_id = uid;
    delete from public.keyword_rules where user_id = uid;
    delete from public.categories where user_id = uid;
    perform private.copy_defaults(uid);
  end loop;
end;
$$;

-- Accounts with data: income moves from 'Income' to 'Rendimentos'.
insert into public.categories (user_id, name, color)
select u.id, d.name, d.color
from auth.users u cross join public.default_categories d
where d.name = 'Rendimentos'
on conflict do nothing;

insert into public.subcategories (user_id, category, name)
select u.id, s.category, s.name
from auth.users u cross join public.default_subcategories s
where s.category = 'Rendimentos'
order by u.id, s.sort_order, s.id
on conflict do nothing;

update public.transactions set category = 'Rendimentos' where type = 'income' and category <> 'Rendimentos';

-- ---------------------------------------------------------------------------
-- Categories: 'Rendimentos' is reserved for income. Moving entries to another category
-- clears their subcategory, which belonged to the old one.
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
  if old_name = 'Rendimentos' then
    raise exception '"Rendimentos" is used for income and cannot be renamed.';
  end if;
  if new_name = '' or length(new_name) > 100 or new_name in ('Income', 'Rendimentos') then
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
  update public.transactions set category = new_name where user_id = uid and category = old_name and type = 'expense';
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
begin
  if not public.is_active_user() then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if category_name = 'Rendimentos' then
    raise exception '"Rendimentos" is used for income and cannot be deleted.';
  end if;
  if not exists (select 1 from public.categories where user_id = uid and name = category_name) then
    raise exception 'There is no category called "%".', category_name;
  end if;
  if reassign_to is not null
     and (reassign_to = category_name or reassign_to = 'Rendimentos'
          or not exists (select 1 from public.categories where user_id = uid and name = reassign_to)) then
    raise exception 'Choose another existing category to move its transactions to.';
  end if;
  if reassign_to is null and (
       exists (select 1 from public.transactions where user_id = uid and category = category_name and type = 'expense')
       or exists (select 1 from public.recurring_expenses where user_id = uid and category = category_name)) then
    raise exception '"%" is still used by transactions or recurring expenses. Choose a category to move them to.', category_name;
  end if;

  if reassign_to is not null then
    update public.transactions set category = reassign_to, subcategory = ''
      where user_id = uid and category = category_name and type = 'expense';
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

-- Delete a subcategory; transactions and recurring expenses that used it keep their
-- category and lose the subcategory.
create function public.delete_subcategory(category_name text, subcategory_name text)
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
  delete from public.subcategories where user_id = uid and category = category_name and name = subcategory_name;
  if not found then
    raise exception 'There is no subcategory "%" in "%".', subcategory_name, category_name;
  end if;
  update public.transactions set subcategory = ''
    where user_id = uid and category = category_name and subcategory = subcategory_name;
  update public.recurring_expenses set subcategory = ''
    where user_id = uid and category = category_name and subcategory = subcategory_name;
end;
$$;

revoke execute on function public.delete_subcategory(text, text) from public, anon;
grant execute on function public.delete_subcategory(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Bulk functions, now with subcategories.
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
      insert into public.transactions (id, date, amount, type, category, subcategory, description, tags, fixed, recurring_id)
      values (
        (item ->> 'id')::uuid,
        (item ->> 'date')::date,
        (item ->> 'amount')::numeric,
        'expense',
        item ->> 'category',
        coalesce(item ->> 'subcategory', ''),
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

-- Adds `subcategories` ([{ "category", "name" }]) to the payload, and `subcategory` to
-- transactions and recurring expenses.
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
  end if;

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

  insert into public.transactions (source_id, date, amount, type, category, subcategory, description, tags, fixed)
  select e ->> 'source_id', (e ->> 'date')::date, (e ->> 'amount')::numeric, e ->> 'type', e ->> 'category',
    coalesce(e ->> 'subcategory', ''), coalesce(e ->> 'description', ''), coalesce(e ->> 'tags', ''),
    coalesce((e ->> 'fixed')::boolean, false)
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
