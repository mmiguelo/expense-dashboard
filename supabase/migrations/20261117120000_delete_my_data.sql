-- Users can remove their own data, for good (unlike deleting single entries, which only
-- hides them):
-- * public.delete_my_data(): every entry, account, category, rule, budget and recurring
--   entry goes; the user keeps their login and starts again from the defaults.
-- * public.delete_my_account(): the login itself goes, and with it (on delete cascade)
--   the profile and all data. Allowed for deactivated users too: people can always erase
--   their data. The owner and the last active admin can't (guard_profile_change says why).

create function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  bulk text := coalesce(current_setting('app.bulk_write', true), '');
begin
  if uid is null then
    raise exception 'You are not signed in.' using errcode = '42501';
  end if;
  if not public.is_active_user() then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  delete from public.transaction_links where user_id = uid;
  delete from public.transactions where user_id = uid;
  delete from public.recurring_occurrences where user_id = uid;
  delete from public.recurring_expenses where user_id = uid;
  delete from public.budgets where user_id = uid;
  delete from public.category_corrections where user_id = uid;
  delete from public.keyword_rules where user_id = uid;
  delete from public.subcategories where user_id = uid;
  delete from public.categories where user_id = uid;
  delete from public.accounts where user_id = uid;
  -- A fresh start, like a new sign-up.
  perform set_config('app.bulk_write', 'on', true);
  perform private.copy_defaults(uid);
  perform private.create_default_account(uid, current_date);
  perform set_config('app.bulk_write', bulk, true);
end;
$$;

revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;

create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'You are not signed in.' using errcode = '42501';
  end if;
  delete from private.write_counters where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
