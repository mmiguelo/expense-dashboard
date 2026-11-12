-- Currency: chosen at sign-up (sent as sign-up metadata), changeable in "My account"
-- only while the user has no transactions: changing it doesn't convert amounts, so with
-- entries it would make them wrong. Changing it also changes the accounts' currency (all
-- accounts use the profile's currency until accounts can have their own).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bulk text := coalesce(current_setting('app.bulk_write', true), '');
  chosen text := upper(coalesce(new.raw_user_meta_data ->> 'currency', ''));
begin
  insert into public.profiles (id, email, display_name, currency)
  values (new.id, coalesce(new.email, ''), split_part(coalesce(new.email, ''), '@', 1),
          case when chosen ~ '^[A-Z]{3}$' then chosen else 'EUR' end);
  -- The defaults (over 100 subcategories) don't count towards the per-minute limit.
  perform set_config('app.bulk_write', 'on', true);
  perform private.copy_defaults(new.id);
  perform private.create_default_account(new.id, current_date);
  perform set_config('app.bulk_write', bulk, true);
  return new;
end;
$$;

create function private.guard_currency_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency is distinct from old.currency then
    -- Each user's own choice (the SQL Editor has no uid and may change it).
    if auth.uid() is not null and auth.uid() <> new.id then
      raise exception 'Only the user can change their currency.' using errcode = '42501';
    end if;
    if exists (select 1 from public.transactions where user_id = new.id) then
      raise exception 'The currency cannot change once there are transactions.' using errcode = '23514';
    end if;
    update public.accounts set currency = new.currency where user_id = new.id;
  end if;
  return new;
end;
$$;

create trigger guard_currency_change before update of currency on public.profiles
  for each row execute function private.guard_currency_change();

grant update (currency) on public.profiles to authenticated;
