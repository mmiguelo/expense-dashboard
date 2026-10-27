begin;
\ir _helpers.psql
select plan(22);

select pg_temp.new_user('admin@test.local') as admin \gset
select pg_temp.new_user('alice@test.local') as alice \gset
select pg_temp.new_user('bob@test.local') as bob \gset
-- The first admin is made by hand, as in the README (no uid: SQL Editor).
update public.profiles set role = 'admin' where id = :'admin';
-- Make it the only admin, whatever else is in the database (undone by the rollback).
update public.profiles set role = 'member' where role = 'admin' and id <> :'admin';

select results_eq(
  format($$select role, active, display_name from public.profiles where id = %L$$, :'alice'),
  $$values ('member'::text, true, 'alice'::text)$$,
  'a new account gets a profile: member, active');

-- ---- a member ----
select pg_temp.act_as(:'alice');
set local role authenticated;

select results_eq('select count(*)::int from public.profiles', array[1], 'a member sees only their own profile');
select is_empty(format('select email from public.profiles where id = %L', :'bob'), 'a member cannot read another profile');
select throws_ok(format($$update public.profiles set role = 'admin' where id = %L$$, :'alice'), '42501', null, 'a member cannot make themselves admin');
select throws_ok(format($$update public.profiles set active = false where id = %L$$, :'alice'), '42501', null, 'a member cannot change their own activation');
select is_empty(format($$update public.profiles set role = 'admin' where id = %L returning id$$, :'bob'), 'a member cannot change another profile (0 rows)');
select is_empty(format($$update public.profiles set display_name = 'x' where id = %L returning id$$, :'admin'), 'a member cannot rename another profile (0 rows)');
select throws_ok(format($$update public.profiles set email = 'x@y.z' where id = %L$$, :'alice'), '42501', null, 'email cannot be changed through the API');
select lives_ok(format($$update public.profiles set display_name = 'Alice' where id = %L$$, :'alice'), 'a member can set their own display name');
select throws_ok(format($$insert into public.profiles (id, email, role) values (%L, 'x@y.z', 'admin')$$, gen_random_uuid()), '42501', null, 'profiles cannot be inserted through the API');
select ok(not public.is_admin(), 'is_admin() is false for a member');
reset role;

-- ---- the admin ----
select pg_temp.act_as(:'admin');
set local role authenticated;
select results_eq('select count(*)::int from public.profiles where email like ''%@test.local''', array[3], 'an admin sees all profiles');
select lives_ok(format($$update public.profiles set role = 'admin', display_name = 'Bobby' where id = %L$$, :'bob'), 'an admin can change another user''s role and name');
select lives_ok(format($$update public.profiles set active = false where id = %L$$, :'alice'), 'an admin can deactivate a member');
select lives_ok(format($$update public.profiles set active = true where id = %L$$, :'alice'), 'an admin can reactivate a member');
select throws_ok(format($$update public.profiles set role = 'member' where id = %L$$, :'admin'), '42501', null, 'an admin cannot change their own role');
select throws_ok(format($$update public.profiles set active = false where id = %L$$, :'admin'), '42501', null, 'an admin cannot deactivate themselves');
-- Two admins now: demoting the other one is allowed.
select lives_ok(format($$update public.profiles set role = 'member' where id = %L$$, :'bob'), 'an admin can demote another admin while one remains');
reset role;

-- ---- the last active admin, even from the SQL Editor ----
select throws_ok(format($$update public.profiles set role = 'member' where id = %L$$, :'admin'), '42501', null, 'the last active admin cannot be demoted');
select throws_ok(format($$update public.profiles set active = false where id = %L$$, :'admin'), '42501', null, 'the last active admin cannot be deactivated');
select throws_ok(format($$delete from auth.users where id = %L$$, :'admin'), '42501', null, 'the last active admin cannot be deleted');
select lives_ok(format($$delete from auth.users where id = %L$$, :'bob'), 'a member can still be deleted');

select * from finish();
rollback;
