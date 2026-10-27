-- Accounts: one profile per auth user, with a role and an active flag.
--
-- Roles: 'member' (default, always for new accounts) or 'admin'. Admins manage accounts
-- and the defaults new users get; they cannot see anyone's financial data (that is
-- enforced by the policies on the data tables, which never mention admins).
--
-- Make the first admin by hand, in the SQL Editor (see README):
--   update public.profiles set role = 'admin' where email = 'you@example.com';

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '' check (length(display_name) <= 100),
  role text not null default 'member' check (role in ('admin', 'member')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index profiles_role_active_idx on public.profiles (role, active);

-- ---------------------------------------------------------------------------
-- Helpers for policies. SECURITY DEFINER so they can read profiles and auth.users
-- whatever the caller's own access is; they only ever answer about the caller.
-- ---------------------------------------------------------------------------

-- The caller may use the app: has a profile, is active, and confirmed their email.
-- Checked by every policy, so deactivation applies immediately, even to a session that
-- is still valid.
create function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = (select auth.uid())
      and p.active
      and u.email_confirmed_at is not null
  );
$$;

-- The caller is an active admin.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user() and exists (
    select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke execute on function public.is_active_user() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Profile for every new auth user (always a member), and email kept in sync.
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), split_part(coalesce(new.email, ''), '@', 1));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

-- Accounts that existed before this migration.
insert into public.profiles (id, email, display_name)
select id, coalesce(email, ''), split_part(coalesce(email, ''), '@', 1) from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Guard rails, enforced for every change, from the app or anywhere else.
-- ---------------------------------------------------------------------------

create function public.guard_profile_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  removes_admin boolean;
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.created_at <> old.created_at then
      raise exception 'profile id and created_at cannot change' using errcode = '42501';
    end if;
    -- Requests from the app (uid is set); the SQL Editor and migrations have no uid.
    if uid is not null then
      if new.email <> old.email then
        raise exception 'email is managed by sign-in' using errcode = '42501';
      end if;
      if not public.is_admin() and (new.role <> old.role or new.active <> old.active) then
        raise exception 'only admins can change roles or activation' using errcode = '42501';
      end if;
      if old.id = uid and new.role <> old.role then
        raise exception 'you cannot change your own role' using errcode = '42501';
      end if;
      if old.id = uid and new.active <> old.active then
        raise exception 'you cannot deactivate your own account' using errcode = '42501';
      end if;
    end if;
    removes_admin := old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active);
  else -- DELETE (e.g. deleting the auth user)
    removes_admin := old.role = 'admin' and old.active;
  end if;

  if removes_admin then
    -- Serialize admin changes, so two admins demoting each other at once can't both win.
    perform pg_advisory_xact_lock(hashtext('public.profiles:admins'));
    if not exists (select 1 from public.profiles where role = 'admin' and active and id <> old.id) then
      raise exception 'there must always be at least one active admin' using errcode = '42501';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger guard_profile_change
  before update or delete on public.profiles
  for each row execute function public.guard_profile_change();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- Everyone can read their own profile (even when deactivated, so the app can say so).
-- Admins can read all profiles. Members never see other profiles.
create policy "Users read their own profile; admins read all" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

-- Active users may edit their own display name; admins may edit any profile. Which
-- columns may change is enforced by guard_profile_change.
create policy "Users update their own profile; admins update any" on public.profiles
  for update to authenticated
  using ((id = (select auth.uid()) and (select public.is_active_user())) or (select public.is_admin()))
  with check ((id = (select auth.uid()) and (select public.is_active_user())) or (select public.is_admin()));

-- No insert or delete policies: profiles are created by the trigger and removed only
-- with the auth user.

-- Only these columns can be changed through the API (whatever the project's default grants).
revoke all on public.profiles from anon, authenticated;
grant select, update (display_name, role, active) on public.profiles to authenticated;
