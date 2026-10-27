-- Expense dashboard schema. Every table holds one user's rows, identified by user_id,
-- and Row Level Security restricts every operation to rows where user_id = auth.uid().
--
-- source_id: the id a row had before it was imported (from localStorage or a JSON backup).
-- Imports skip rows whose source_id, or id, is already in the user's account, so
-- importing the same data twice adds nothing.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.categories (
  -- Identity order is display order.
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- Monthly budget per category name.
create table public.budgets (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category text not null check (length(category) between 1 and 100),
  amount numeric(12, 2) not null check (amount > 0),
  primary key (user_id, category)
);

create table public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  -- Order the rows were added in.
  seq bigint generated always as identity,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  description text not null check (length(description) between 1 and 500),
  amount numeric(12, 2) not null check (amount > 0),
  category text not null,
  -- Day of month; months with fewer days use their last day.
  day smallint not null check (day between 1 and 31),
  -- First month to generate; always the 1st of that month.
  start_month date not null check (extract(day from start_month) = 1),
  source_id text,
  created_at timestamptz not null default now(),
  -- Lets other tables require that a referenced recurring expense has the same owner.
  unique (id, user_id)
);

-- Months already generated for a recurring expense. The primary key is what makes
-- generation idempotent: a month can be generated only once, from any device. Rows stay
-- when the generated transaction is deleted, so deleted occurrences don't come back.
create table public.recurring_occurrences (
  recurring_id uuid not null,
  -- 1st of the month.
  month date not null check (extract(day from month) = 1),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (recurring_id, month),
  foreign key (recurring_id, user_id) references public.recurring_expenses (id, user_id) on delete cascade
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  -- Order the rows were added in; breaks ties between transactions on the same date.
  seq bigint generated always as identity,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  type text not null check (type in ('expense', 'income')),
  category text not null check (length(category) between 1 and 100),
  description text not null default '' check (length(description) <= 500),
  tags text not null default '' check (length(tags) <= 500),
  -- Generated from a recurring expense.
  fixed boolean not null default false,
  recurring_id uuid,
  source_id text,
  created_at timestamptz not null default now(),
  -- Deleting a recurring expense keeps its past transactions.
  foreign key (recurring_id, user_id) references public.recurring_expenses (id, user_id) on delete set null (recurring_id)
);

-- Category the user picked for a merchant (lower-cased description), used for guessing.
create table public.category_corrections (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  merchant text not null check (merchant = lower(merchant) and length(merchant) between 1 and 500),
  category text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, merchant)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index transactions_user_id_date_idx on public.transactions (user_id, date);
create index recurring_occurrences_user_id_month_idx on public.recurring_occurrences (user_id, month);
create index recurring_expenses_user_id_start_month_idx on public.recurring_expenses (user_id, start_month);
create index transactions_recurring_id_idx on public.transactions (recurring_id) where recurring_id is not null;

-- Import de-duplication: one row per original id per user.
create unique index transactions_user_id_origin_key on public.transactions (user_id, coalesce(source_id, id::text));
create unique index recurring_expenses_user_id_origin_key on public.recurring_expenses (user_id, coalesce(source_id, id::text));

-- ---------------------------------------------------------------------------
-- Row Level Security: each user can only read and change their own rows.
-- (select auth.uid()) is evaluated once per statement instead of once per row.
-- ---------------------------------------------------------------------------

alter table public.categories enable row level security;
alter table public.budgets enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.recurring_occurrences enable row level security;
alter table public.transactions enable row level security;
alter table public.category_corrections enable row level security;

create policy "Users can read their categories" on public.categories
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can add their categories" on public.categories
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can change their categories" on public.categories
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their categories" on public.categories
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can read their budgets" on public.budgets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can add their budgets" on public.budgets
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can change their budgets" on public.budgets
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their budgets" on public.budgets
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can read their recurring expenses" on public.recurring_expenses
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can add their recurring expenses" on public.recurring_expenses
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can change their recurring expenses" on public.recurring_expenses
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their recurring expenses" on public.recurring_expenses
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can read their recurring occurrences" on public.recurring_occurrences
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can add their recurring occurrences" on public.recurring_occurrences
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can change their recurring occurrences" on public.recurring_occurrences
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their recurring occurrences" on public.recurring_occurrences
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can read their transactions" on public.transactions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can add their transactions" on public.transactions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can change their transactions" on public.transactions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their transactions" on public.transactions
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Users can read their category corrections" on public.category_corrections
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can add their category corrections" on public.category_corrections
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can change their category corrections" on public.category_corrections
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their category corrections" on public.category_corrections
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Signed-out (anon) requests get nothing: no policies apply to them, and no grants either.
revoke all on public.categories, public.budgets, public.recurring_expenses, public.recurring_occurrences,
  public.transactions, public.category_corrections from anon;
