begin;
\ir _helpers.psql
select plan(43);

select pg_temp.new_user('admin@test.local') as admin \gset
select pg_temp.new_user('alice@test.local') as alice \gset
select pg_temp.new_user('bob@test.local') as bob \gset
select pg_temp.new_user('dave@test.local') as dave \gset
select pg_temp.new_user('carol@test.local', confirmed => false) as carol \gset
update public.profiles set role = 'admin' where id = :'admin';

-- Every per-user data table, and a way to count what the current caller can see in each.
create function pg_temp.visible_rows(owner uuid) returns int language plpgsql as $$
declare t text; n int; total int := 0;
begin
  foreach t in array array['transactions','categories','keyword_rules','budgets','recurring_expenses','recurring_occurrences','category_corrections'] loop
    execute format('select count(*) from public.%I where user_id = $1', t) into n using owner;
    total := total + n;
  end loop;
  return total;
end $$;

-- New accounts start with a copy of the defaults.
select results_eq(format('select count(*)::int from public.categories where user_id = %L', :'alice'),
  'select count(*)::int from public.default_categories', 'a new account gets the default categories');
select results_eq(format('select count(*)::int from public.keyword_rules where user_id = %L', :'alice'),
  'select count(*)::int from public.default_keyword_rules', 'a new account gets the default keyword rules');
select results_eq(format($$select category from public.keyword_rules where user_id = %L and keyword = 'pingo doce'$$, :'alice'),
  $$values ('Groceries'::text)$$, 'keyword rules are copied with their category');

-- Give Alice and Dave one row in every table, acting as themselves.
create function pg_temp.fill(uid uuid) returns void language plpgsql as $$
declare rid uuid := gen_random_uuid();
begin
  perform pg_temp.act_as(uid);
  set local role authenticated;
  insert into public.transactions (date, amount, type, category, description) values ('2026-03-01', 10, 'expense', 'Groceries', 'mine');
  insert into public.budgets (category, amount) values ('Groceries', 100);
  insert into public.recurring_expenses (id, description, amount, category, day, start_month) values (rid, 'Rent', 500, 'Mortgage', 1, '2026-01-01');
  insert into public.recurring_occurrences (recurring_id, month) values (rid, '2026-01-01');
  insert into public.category_corrections (merchant, category) values ('lidl', 'Groceries');
  reset role;
end $$;
select pg_temp.fill(:'alice');
select pg_temp.fill(:'dave');
select results_eq(format('select pg_temp.visible_rows(%L)', :'alice'), array[13 + 84 + 5], 'setup: Alice has rows in every table (as superuser)');

-- ---- another member ----
select pg_temp.act_as(:'bob');
set local role authenticated;
select is(pg_temp.visible_rows(:'alice'), 0, 'a member sees none of another member''s rows, in any table');
select is_empty(format($$update public.transactions set amount = 1 where user_id = %L returning id$$, :'alice'), 'a member cannot change another member''s transactions');
select is_empty(format($$delete from public.transactions where user_id = %L returning id$$, :'alice'), 'a member cannot delete another member''s transactions');
select is_empty(format($$update public.categories set color = '#000000' where user_id = %L returning id$$, :'alice'), 'a member cannot change another member''s categories');
select is_empty(format($$delete from public.keyword_rules where user_id = %L returning id$$, :'alice'), 'a member cannot delete another member''s keyword rules');
select is_empty(format($$update public.budgets set amount = 1 where user_id = %L returning category$$, :'alice'), 'a member cannot change another member''s budgets');
select is_empty(format($$delete from public.recurring_expenses where user_id = %L returning id$$, :'alice'), 'a member cannot delete another member''s recurring expenses');
select throws_ok(format($$insert into public.transactions (user_id, date, amount, type, category) values (%L, '2026-01-01', 1, 'expense', 'X')$$, :'alice'),
  '42501', null, 'a member cannot insert rows owned by someone else');
insert into public.transactions (date, amount, type, category) values ('2026-01-01', 1, 'expense', 'X');
select throws_ok(format($$update public.transactions set user_id = %L$$, :'alice'), '42501', null, 'a member cannot give their rows to someone else');
reset role;
select results_eq(format('select pg_temp.visible_rows(%L)', :'alice'), array[13 + 84 + 5], 'Alice''s rows are unchanged');

-- ---- the admin: account info yes, financial data no ----
select pg_temp.act_as(:'admin');
set local role authenticated;
select ok(public.is_admin(), 'is_admin() is true for the admin');
select is(pg_temp.visible_rows(:'alice'), 0, 'an admin cannot read a member''s data, in any table');
select is_empty(format($$select amount from public.transactions where user_id = %L$$, :'alice'), 'an admin cannot read a member''s transactions');
select is_empty(format($$update public.transactions set amount = 1 where user_id = %L returning id$$, :'alice'), 'an admin cannot change a member''s transactions');
select isnt_empty(format($$select email, role, active from public.profiles where id = %L$$, :'alice'), 'an admin can read a member''s account info');
reset role;

-- ---- defaults: everyone reads, only admins write ----
select pg_temp.act_as(:'alice');
set local role authenticated;
select isnt_empty('select * from public.default_categories', 'a member can read the default categories');
select isnt_empty('select * from public.default_keyword_rules', 'a member can read the default keyword rules');
select throws_ok($$insert into public.default_categories (name, color) values ('Hacked', '#000000')$$, '42501', null, 'a member cannot add default categories');
select is_empty($$update public.default_categories set color = '#000000' returning id$$, 'a member cannot change default categories');
select is_empty($$delete from public.default_keyword_rules returning id$$, 'a member cannot delete default keyword rules');
reset role;

select pg_temp.act_as(:'admin');
set local role authenticated;
select lives_ok($$insert into public.default_categories (name, color, sort_order) values ('Pets', '#c05299', 200)$$, 'an admin can add a default category');
select lives_ok($$insert into public.default_keyword_rules (category, keyword) values ('Pets', 'vet')$$, 'an admin can add a default keyword rule');
select lives_ok($$update public.default_categories set name = 'Animals' where name = 'Pets'$$, 'an admin can rename a default category');
select results_eq($$select category from public.default_keyword_rules where keyword = 'vet'$$, $$values ('Animals'::text)$$, 'renaming a default category updates its rules');
reset role;
select pg_temp.new_user('erin@test.local') as erin \gset
select results_eq(format($$select category from public.keyword_rules where user_id = %L and keyword = 'vet'$$, :'erin'),
  $$values ('Animals'::text)$$, 'accounts created later get the changed defaults');

-- ---- deactivation: locked out immediately, data kept, restored on reactivation ----
select pg_temp.act_as(:'admin');
set local role authenticated;
update public.profiles set active = false where id = :'dave';
reset role;

-- Dave's session (JWT) is still valid: the same claims as before.
select pg_temp.act_as(:'dave');
set local role authenticated;
select ok(not public.is_active_user(), 'is_active_user() is false once deactivated');
select is(pg_temp.visible_rows(:'dave'), 0, 'a deactivated user cannot read their own rows, in any table');
select is_empty('select * from public.default_categories', 'a deactivated user cannot read the defaults');
select throws_ok($$insert into public.transactions (date, amount, type, category) values ('2026-01-01', 1, 'expense', 'X')$$, '42501', null, 'a deactivated user cannot add transactions');
select throws_ok($$insert into public.categories (name, color) values ('New', '#000000')$$, '42501', null, 'a deactivated user cannot add categories');
select is_empty('update public.transactions set amount = 1 returning id', 'a deactivated user cannot change transactions');
select is_empty('delete from public.budgets returning category', 'a deactivated user cannot delete budgets');
select is_empty($$update public.profiles set display_name = 'x' returning id$$, 'a deactivated user cannot change their profile');
select results_eq('select active from public.profiles', array[false], 'a deactivated user can still see that they are deactivated');
reset role;
select results_eq(format('select pg_temp.visible_rows(%L)', :'dave'), array[13 + 84 + 5], 'deactivation keeps all of the user''s data');

select pg_temp.act_as(null);  -- superuser without a signed-in user, like the SQL Editor
update public.profiles set active = true where id = :'dave';
select pg_temp.act_as(:'dave');
set local role authenticated;
select is(pg_temp.visible_rows(:'dave'), 13 + 84 + 5, 'reactivating restores access to all of it');
reset role;

-- ---- unconfirmed email: no access even with a token ----
select pg_temp.act_as(:'carol');
set local role authenticated;
select ok(not public.is_active_user(), 'is_active_user() is false for an unconfirmed email');
select is(pg_temp.visible_rows(:'carol'), 0, 'an unconfirmed user cannot read their rows');
select throws_ok($$insert into public.transactions (date, amount, type, category) values ('2026-01-01', 1, 'expense', 'X')$$, '42501', null, 'an unconfirmed user cannot add data');
reset role;

select * from finish();
rollback;
