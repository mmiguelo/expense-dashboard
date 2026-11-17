begin;
\ir _helpers.psql
select plan(13);

select pg_temp.new_user('alice@test.local') as alice \gset
select pg_temp.new_user('bob@test.local') as bob \gset
select pg_temp.new_user('gone@test.local') as gone \gset
select pg_temp.new_user('boss@test.local') as boss \gset
-- boss is the owner (and the only active admin).
update public.profiles set owner = false where owner;
update public.profiles set role = 'admin', owner = true where id = :'boss';
update public.profiles set role = 'member' where role = 'admin' and id <> :'boss';
select count(*)::int as default_cats from public.default_categories \gset

-- alice and bob each have an entry, a second account, a rule and a budget.
select pg_temp.act_as(:'alice');
set local role authenticated;
insert into public.accounts (name, kind) values ('Poupança', 'savings');
insert into public.transactions (date, amount, type, category, description) values ('2026-11-01', 12, 'expense', 'Alimentação', 'Lidl');
insert into public.categories (name, color) values ('Mine', '#000000');
insert into public.budgets (category, amount) values ('Mine', 50);
reset role;
select pg_temp.act_as(:'bob');
set local role authenticated;
insert into public.transactions (date, amount, type, category, description) values ('2026-11-01', 7, 'expense', 'Alimentação', 'Café');
reset role;

-- ---- delete_my_data: everything goes, the login stays, a fresh start ----
select pg_temp.act_as(:'alice');
set local role authenticated;
select lives_ok('select public.delete_my_data()', 'a user can delete all their data');
select is_empty('select 1 from public.transactions', 'their entries are gone');
select is_empty('select 1 from public.budgets', 'and their budgets');
select is_empty($$select 1 from public.categories where name = 'Mine'$$, 'and their own categories');
select results_eq($$select name, kind from public.accounts$$, $$values ('Conta principal'::text, 'checking'::text)$$, 'they start again with one account');
select results_eq('select count(*)::int from public.categories', format('values (%s)', :default_cats), 'and the default categories');
reset role;
select is((select count(*)::int from public.transactions where user_id = :'alice'), 0, 'nothing is left hidden (no soft delete)');
select is((select count(*)::int from public.transactions where user_id = :'bob'), 1, 'other users keep their data');
select is((select count(*)::int from public.profiles where id = :'alice'), 1, 'the login stays');

-- ---- delete_my_account: the login and everything with it ----
select pg_temp.act_as(:'gone');
set local role authenticated;
select lives_ok('select public.delete_my_account()', 'a user can delete their account');
reset role;
select is((select count(*)::int from auth.users where id = :'gone'), 0, 'the login is gone');
select is((select count(*)::int from public.accounts where user_id = :'gone') + (select count(*)::int from public.categories where user_id = :'gone'), 0, 'and all their data');

select pg_temp.act_as(:'boss');
set local role authenticated;
select throws_ok('select public.delete_my_account()', '42501', null, 'the owner cannot delete their account');
reset role;

select * from finish();
rollback;
