-- Soft-deleting an account leaves its transactions out of every balance and report, so:
-- * an account linked to others by transfers can't be soft-deleted (their balances would
--   change without warning); it can be archived instead;
-- * the last open account can't be soft-deleted or archived (new entries need one).

create function private.guard_account_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null
     and exists (select 1 from public.transactions t
                 where t.type = 'transfer' and t.deleted_at is null and new.id in (t.account_id, t.to_account_id)) then
    raise exception 'This account has transfers to or from other accounts. Archive it instead.' using errcode = '23514';
  end if;
  if (new.deleted_at is not null or new.archived) and old.deleted_at is null and not old.archived
     and not exists (select 1 from public.accounts a
                     where a.user_id = new.user_id and a.id <> new.id and a.deleted_at is null and not a.archived) then
    raise exception 'You need at least one open account.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger guard_account_change before update on public.accounts
  for each row execute function private.guard_account_change();
