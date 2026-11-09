-- The owner: one protected admin account.
--
-- * The owner is an admin that nobody can demote, deactivate or delete.
-- * Only the owner can demote or deactivate other admins. Other admins can promote
--   members to admin and deactivate or reactivate members, but not touch other admins.
-- * The flag can't be changed through the API, only in the SQL Editor:
--     update public.profiles set owner = true where email = 'you@example.com';
--   To hand ownership over, unset it on the old owner first (there is only one).

alter table public.profiles
  add column owner boolean not null default false,
  add constraint profiles_owner_is_active_admin check (not owner or (role = 'admin' and active));

create unique index profiles_single_owner_idx on public.profiles (owner) where owner;

-- An existing deployment with exactly one active admin: that admin is the owner.
update public.profiles set owner = true
where role = 'admin' and active
  and (select count(*) from public.profiles where role = 'admin' and active) = 1;

-- The caller is the (active) owner.
create function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() and exists (
    select 1 from public.profiles where id = (select auth.uid()) and owner
  );
$$;

revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create or replace function public.guard_profile_change()
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
      if new.owner <> old.owner then
        raise exception 'the owner can only be changed in the SQL Editor' using errcode = '42501';
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
      if old.owner and (new.role <> old.role or new.active <> old.active) then
        raise exception 'the owner account cannot be demoted or deactivated' using errcode = '42501';
      end if;
      if old.role = 'admin' and (new.role <> 'admin' or (old.active and not new.active))
         and not public.is_owner() then
        raise exception 'only the owner can demote or deactivate an admin' using errcode = '42501';
      end if;
    end if;
    removes_admin := old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active);
  else -- DELETE (e.g. deleting the auth user)
    if old.owner then
      raise exception 'the owner account cannot be deleted; unset owner first' using errcode = '42501';
    end if;
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

-- owner is readable (the app shows it) but not in the update grant, so it can't be
-- changed through the API.
grant select on public.profiles to authenticated;
