begin;
\ir _helpers.psql
select plan(16);

select pg_temp.new_user('owner@test.local') as owner \gset
select pg_temp.new_user('admin2@test.local') as admin2 \gset
select pg_temp.new_user('admin3@test.local') as admin3 \gset
select pg_temp.new_user('carol@test.local') as carol \gset
-- Set up by hand (no uid: SQL Editor), whatever else is in the database.
update public.profiles set owner = false where owner;
update public.profiles set role = 'member' where role = 'admin';
update public.profiles set role = 'admin', owner = true where id = :'owner';
update public.profiles set role = 'admin' where id in (:'admin2', :'admin3');

-- ---- an admin who is not the owner ----
select pg_temp.act_as(:'admin2');
set local role authenticated;
select ok(not public.is_owner(), 'is_owner() is false for a plain admin');
select lives_ok(format($$update public.profiles set role = 'admin' where id = %L$$, :'carol'), 'an admin can promote a member');
select throws_ok(format($$update public.profiles set role = 'member' where id = %L$$, :'carol'), '42501', null, 'an admin cannot demote another admin');
select throws_ok(format($$update public.profiles set active = false where id = %L$$, :'admin3'), '42501', null, 'an admin cannot deactivate another admin');
select throws_ok(format($$update public.profiles set role = 'member' where id = %L$$, :'owner'), '42501', null, 'an admin cannot demote the owner');
select throws_ok(format($$update public.profiles set active = false where id = %L$$, :'owner'), '42501', null, 'an admin cannot deactivate the owner');
select throws_ok(format($$update public.profiles set owner = true where id = %L$$, :'admin2'), '42501', null, 'an admin cannot make themselves owner');
select lives_ok(format($$update public.profiles set display_name = 'Boss' where id = %L$$, :'owner'), 'an admin can still rename the owner');
reset role;

-- ---- the owner ----
select pg_temp.act_as(:'owner');
set local role authenticated;
select ok(public.is_owner(), 'is_owner() is true for the owner');
select lives_ok(format($$update public.profiles set active = false where id = %L$$, :'admin3'), 'the owner can deactivate an admin');
select lives_ok(format($$update public.profiles set active = true where id = %L$$, :'admin3'), 'the owner can reactivate an admin');
select lives_ok(format($$update public.profiles set role = 'member' where id = %L$$, :'carol'), 'the owner can demote an admin');
select throws_ok(format($$update public.profiles set owner = false where id = %L$$, :'owner'), '42501', null, 'the owner flag cannot be changed through the API');
reset role;

-- ---- even from the SQL Editor (no signed-in user) ----
select set_config('request.jwt.claims', '', true);
select throws_ok(format($$delete from auth.users where id = %L$$, :'owner'), '42501', null, 'the owner cannot be deleted');
select throws_ok(format($$update public.profiles set owner = true where id = %L$$, :'admin2'), '23505', null, 'there is only one owner');
select throws_ok(format($$update public.profiles set role = 'member' where id = %L$$, :'owner'), '23514', null, 'the owner must stay an active admin');

select * from finish();
rollback;
