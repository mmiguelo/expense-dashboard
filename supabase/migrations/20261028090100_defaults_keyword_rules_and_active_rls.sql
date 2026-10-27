-- Defaults every new account starts with, per-user keyword rules, and Row Level Security
-- that also requires an active, confirmed account on every data table.

-- ---------------------------------------------------------------------------
-- Defaults (managed by admins, read by everyone signed in)
-- ---------------------------------------------------------------------------

create table public.default_categories (
  id bigint generated always as identity primary key,
  name text not null unique check (length(trim(name)) between 1 and 100),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0
);

-- A description containing `keyword` (case-insensitive, padded with spaces, so 'nos '
-- only matches the whole word) is guessed as `category`.
create table public.default_keyword_rules (
  id bigint generated always as identity primary key,
  category text not null references public.default_categories (name) on update cascade on delete cascade,
  keyword text not null unique check (keyword = lower(keyword) and length(keyword) between 1 and 100)
);

-- Values that were hardcoded in the app until now.
insert into public.default_categories (name, color, sort_order) values
  ('Groceries', '#3fa66b', 10),
  ('Utilities', '#e0a526', 20),
  ('Insurance', '#8a63d2', 30),
  ('Mortgage', '#d1495b', 40),
  ('Gym', '#e97a3b', 50),
  ('Transportation', '#2aa6b8', 60),
  ('Fuel', '#7a8699', 70),
  ('Education', '#2f5bea', 80),
  ('Leisure', '#d65db1', 90),
  ('Health', '#4cc3a0', 100),
  ('Phone & Internet', '#5b8def', 110),
  ('Shopping', '#b5651d', 120),
  ('Other', '#9aa5b5', 130);

insert into public.default_keyword_rules (category, keyword) values
  ('Groceries', 'pingo doce'),
  ('Groceries', 'continente'),
  ('Groceries', 'lidl'),
  ('Groceries', 'aldi'),
  ('Groceries', 'minipreço'),
  ('Groceries', 'intermarché'),
  ('Groceries', 'mercado'),
  ('Groceries', 'supermarket'),
  ('Groceries', 'padaria'),
  ('Groceries', 'talho'),
  ('Utilities', 'edp'),
  ('Utilities', 'endesa'),
  ('Utilities', 'energy'),
  ('Utilities', 'electric'),
  ('Utilities', 'luz'),
  ('Utilities', 'gas'),
  ('Utilities', 'água'),
  ('Utilities', 'agua'),
  ('Utilities', 'water'),
  ('Utilities', 'epal'),
  ('Insurance', 'insurance'),
  ('Insurance', 'seguro'),
  ('Insurance', 'fidelidade'),
  ('Insurance', 'ageas'),
  ('Mortgage', 'mortgage'),
  ('Mortgage', 'crédito habitação'),
  ('Mortgage', 'loan'),
  ('Mortgage', 'prestação'),
  ('Gym', 'gym'),
  ('Gym', 'ginásio'),
  ('Gym', 'holmes'),
  ('Gym', 'fitness'),
  ('Transportation', 'bus'),
  ('Transportation', 'autocarro'),
  ('Transportation', 'metro'),
  ('Transportation', 'train'),
  ('Transportation', 'uber'),
  ('Transportation', 'bolt'),
  ('Transportation', 'taxi'),
  ('Transportation', 'passe'),
  ('Fuel', 'fuel'),
  ('Fuel', 'petrol'),
  ('Fuel', 'diesel'),
  ('Fuel', 'gasolina'),
  ('Fuel', 'gasóleo'),
  ('Fuel', 'galp'),
  ('Fuel', 'repsol'),
  ('Fuel', 'shell'),
  ('Education', 'school'),
  ('Education', 'course'),
  ('Education', 'udemy'),
  ('Education', 'book'),
  ('Education', 'livro'),
  ('Education', 'tuition'),
  ('Education', 'escola'),
  ('Leisure', 'restaurant'),
  ('Leisure', 'restaurante'),
  ('Leisure', 'cinema'),
  ('Leisure', 'café'),
  ('Leisure', 'cafe'),
  ('Leisure', 'netflix'),
  ('Leisure', 'spotify'),
  ('Leisure', 'movie'),
  ('Leisure', 'pizza'),
  ('Leisure', 'sushi'),
  ('Health', 'pharmacy'),
  ('Health', 'farmácia'),
  ('Health', 'doctor'),
  ('Health', 'médico'),
  ('Health', 'dentist'),
  ('Health', 'dentista'),
  ('Health', 'clinic'),
  ('Phone & Internet', 'nos '),
  ('Phone & Internet', 'meo'),
  ('Phone & Internet', 'vodafone'),
  ('Phone & Internet', 'nowo'),
  ('Phone & Internet', 'internet'),
  ('Phone & Internet', 'phone'),
  ('Shopping', 'amazon'),
  ('Shopping', 'zara'),
  ('Shopping', 'ikea'),
  ('Shopping', 'fnac'),
  ('Shopping', 'worten'),
  ('Shopping', 'roupa');
-- ---------------------------------------------------------------------------
-- Each user's own keyword rules (a copy of the defaults, then theirs to change)
-- ---------------------------------------------------------------------------

create table public.keyword_rules (
  -- Identity order is matching order: the first rule that matches wins.
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  keyword text not null check (keyword = lower(keyword) and length(keyword) between 1 and 100),
  category text not null check (length(category) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (user_id, keyword)
);

-- ---------------------------------------------------------------------------
-- New accounts: profile (always a member) plus a copy of the defaults.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), split_part(coalesce(new.email, ''), '@', 1));

  insert into public.categories (user_id, name, color)
  select new.id, name, color from public.default_categories order by sort_order, id;

  insert into public.keyword_rules (user_id, keyword, category)
  select new.id, r.keyword, r.category
  from public.default_keyword_rules r
  join public.default_categories c on c.name = r.category
  order by c.sort_order, c.id, r.id;

  return new;
end;
$$;

-- Existing accounts: categories if they have none, and keyword rules.
insert into public.categories (user_id, name, color)
select u.id, d.name, d.color
from auth.users u cross join public.default_categories d
where not exists (select 1 from public.categories c where c.user_id = u.id)
order by u.id, d.sort_order, d.id;

insert into public.keyword_rules (user_id, keyword, category)
select u.id, r.keyword, r.category
from auth.users u
cross join public.default_keyword_rules r
join public.default_categories c on c.name = r.category
where not exists (select 1 from public.keyword_rules k where k.user_id = u.id)
order by u.id, c.sort_order, c.id, r.id;

-- ---------------------------------------------------------------------------
-- Row Level Security: own rows only, and only while the account is active and its
-- email confirmed. Admins get nothing extra here: they cannot read anyone's data.
-- ---------------------------------------------------------------------------

alter table public.keyword_rules enable row level security;

do $$
declare
  t text;
  label text;
begin
  for t, label in values
    ('categories', 'categories'),
    ('budgets', 'budgets'),
    ('recurring_expenses', 'recurring expenses'),
    ('recurring_occurrences', 'recurring occurrences'),
    ('transactions', 'transactions'),
    ('category_corrections', 'category corrections'),
    ('keyword_rules', 'keyword rules')
  loop
    execute format('drop policy if exists %I on public.%I', 'Users can read their ' || label, t);
    execute format('drop policy if exists %I on public.%I', 'Users can add their ' || label, t);
    execute format('drop policy if exists %I on public.%I', 'Users can change their ' || label, t);
    execute format('drop policy if exists %I on public.%I', 'Users can delete their ' || label, t);

    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id and (select public.is_active_user()))',
      'Active users can read their ' || label, t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id and (select public.is_active_user()))',
      'Active users can add their ' || label, t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id and (select public.is_active_user())) with check ((select auth.uid()) = user_id and (select public.is_active_user()))',
      'Active users can change their ' || label, t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id and (select public.is_active_user()))',
      'Active users can delete their ' || label, t);
  end loop;
end;
$$;

alter table public.default_categories enable row level security;
alter table public.default_keyword_rules enable row level security;

create policy "Active users can read default categories" on public.default_categories
  for select to authenticated using ((select public.is_active_user()));
create policy "Admins can add default categories" on public.default_categories
  for insert to authenticated with check ((select public.is_admin()));
create policy "Admins can change default categories" on public.default_categories
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins can delete default categories" on public.default_categories
  for delete to authenticated using ((select public.is_admin()));

create policy "Active users can read default keyword rules" on public.default_keyword_rules
  for select to authenticated using ((select public.is_active_user()));
create policy "Admins can add default keyword rules" on public.default_keyword_rules
  for insert to authenticated with check ((select public.is_admin()));
create policy "Admins can change default keyword rules" on public.default_keyword_rules
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins can delete default keyword rules" on public.default_keyword_rules
  for delete to authenticated using ((select public.is_admin()));

revoke all on public.keyword_rules, public.default_categories, public.default_keyword_rules from anon;
grant select, insert, update, delete on public.keyword_rules, public.default_categories, public.default_keyword_rules to authenticated;
