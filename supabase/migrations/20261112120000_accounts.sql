-- Money accounts: where money is (a current account, a savings account, a meal card, a
-- credit card). Not to be confused with the sign-in account (profiles).
--
-- * kind decides behaviour only through generic rules: checking counts as money available
--   to spend; savings, restricted (meal card, benefits wallet) and credit don't; a credit
--   balance is normally negative (a debt). Nothing depends on the name or institution.
-- * The balance is opening_balance plus the transactions dated on or after opening_date.
-- * archived: closed but part of history (still in reports). deleted_at: soft-deleted,
--   left out of everything, restorable.
-- * currency: each account's currency; until multi-currency arrives it is always the
--   profile's currency, which is also the currency totals are reported in.

alter table public.profiles add column currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$');

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  -- Order the rows were added in.
  seq bigint generated always as identity,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  kind text not null check (kind in ('checking', 'savings', 'restricted', 'credit')),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  opening_balance numeric(12, 2) not null default 0,
  opening_date date not null default current_date,
  -- A label only (e.g. the bank's name); never used in logic.
  institution text not null default '' check (length(institution) <= 100),
  archived boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  -- Lets other tables require that a referenced account has the same owner.
  unique (id, user_id)
);

create index accounts_user_idx on public.accounts (user_id, seq);

alter table public.accounts enable row level security;

create policy "Active users can read their accounts" on public.accounts
  for select to authenticated using ((select auth.uid()) = user_id and (select public.is_active_user()));
create policy "Active users can add their accounts" on public.accounts
  for insert to authenticated with check ((select auth.uid()) = user_id and (select public.is_active_user()));
create policy "Active users can change their accounts" on public.accounts
  for update to authenticated
  using ((select auth.uid()) = user_id and (select public.is_active_user()))
  with check ((select auth.uid()) = user_id and (select public.is_active_user()));
create policy "Active users can delete their accounts" on public.accounts
  for delete to authenticated using ((select auth.uid()) = user_id and (select public.is_active_user()));

grant select, insert, update, delete on public.accounts to authenticated;

create trigger enforce_write_limits after insert on public.accounts
  referencing new table as new_rows for each statement execute function private.enforce_write_limits('100');

-- ---------------------------------------------------------------------------
-- Every user starts with one current account
-- ---------------------------------------------------------------------------

/** The account everything goes to until the user sets up others. */
create function private.create_default_account(uid uuid, opening date)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.accounts (user_id, name, kind, currency, opening_date)
  select uid, 'Conta principal', 'checking', p.currency, opening
  from public.profiles p
  where p.id = uid
    and not exists (select 1 from public.accounts a where a.user_id = uid);
$$;

revoke all on function private.create_default_account(uuid, date) from public, anon, authenticated;

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
  perform private.create_default_account(new.id, current_date);
  perform set_config('app.bulk_write', bulk, true);
  return new;
end;
$$;

-- Existing users: the default account opens on their first transaction, with a balance
-- of 0 there; they set the real opening balance and date themselves.
do $$
declare
  p record;
begin
  perform set_config('app.bulk_write', 'on', true);
  for p in
    select pr.id, coalesce((select min(t.date) from public.transactions t where t.user_id = pr.id), current_date) as opening
    from public.profiles pr
  loop
    perform private.create_default_account(p.id, p.opening);
  end loop;
end;
$$;
