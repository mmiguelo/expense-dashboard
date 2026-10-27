begin;
\ir _helpers.psql
select plan(23);

select pg_temp.new_user('alice@test.local') as alice \gset
select pg_temp.new_user('bob@test.local') as bob \gset
select pg_temp.new_user('dave@test.local') as dave \gset
update public.profiles set active = false where id = :'dave';

-- ---- per-minute limit (120 new rows per user) ----
select pg_temp.act_as(:'alice');
set local role authenticated;
select lives_ok($$insert into public.transactions (date, amount, type, category)
  select '2026-03-01', 1, 'expense', 'Groceries' from generate_series(1, 120)$$, '120 new rows in a minute are fine');
select throws_like($$insert into public.transactions (date, amount, type, category) values ('2026-03-01', 1, 'expense', 'Groceries')$$,
  'Too many changes at once%', 'the 121st new row in a minute is refused');
select throws_like($$insert into public.budgets (category, amount) values ('Gym', 10)$$,
  'Too many changes at once%', 'the limit counts all tables together');
select lives_ok($$select public.import_snapshot(jsonb_build_object('transactions',
  (select jsonb_agg(jsonb_build_object('source_id', i::text, 'date', '2026-03-02', 'amount', 2, 'type', 'expense', 'category', 'Fuel'))
   from generate_series(1, 500) i)))$$, 'an import is not held back by the per-minute limit');
select throws_like($$select public.import_snapshot(jsonb_build_object('transactions',
  (select jsonb_agg(jsonb_build_object('source_id', 'big' || i, 'date', '2026-03-02', 'amount', 2, 'type', 'expense', 'category', 'Fuel'))
   from generate_series(1, 20001) i)))$$, 'This backup is too large%', 'an import of more than 20,000 transactions is refused');
select throws_ok('select * from private.write_counters', '42501', null, 'the counters are not readable through the API');
reset role;

-- Bob has his own counter.
select pg_temp.act_as(:'bob');
set local role authenticated;
select lives_ok($$insert into public.budgets (category, amount) values ('Gym', 10)$$, 'other users are not affected by Alice''s limit');
reset role;

-- ---- maximum rows per table (200 categories), also from the SQL Editor ----
select pg_temp.act_as(null);
select lives_ok(format($$insert into public.categories (user_id, name, color)
  select %L, 'Extra ' || i, '#000000' from generate_series(1, 200 - 13) i$$, :'bob'), 'up to 200 categories');
select throws_like(format($$insert into public.categories (user_id, name, color) values (%L, 'One too many', '#000000')$$, :'bob'),
  'Limit reached: an account can have at most 200 rows in categories%', 'the 201st category is refused');

-- ---- rename and delete categories ----
insert into public.transactions (user_id, date, amount, type, category, description)
  values (:'bob', '2026-03-01', 5, 'expense', 'Groceries', 'bob groceries'),
         (:'bob', '2026-03-01', 7, 'income', 'Groceries', 'odd income');
insert into public.budgets (user_id, category, amount) values (:'bob', 'Groceries', 300);
insert into public.category_corrections (user_id, merchant, category) values (:'bob', 'lidl', 'Groceries');
insert into public.recurring_expenses (user_id, description, amount, category, day, start_month) values (:'bob', 'Box', 20, 'Groceries', 1, '2026-01-01');

select pg_temp.act_as(:'bob');
set local role authenticated;
select lives_ok($$select public.rename_category('Groceries', 'Food')$$, 'a category can be renamed');
select results_eq($$select
    (select count(*) from public.transactions where category = 'Food')::int,
    (select count(*) from public.budgets where category = 'Food')::int,
    (select count(*) from public.keyword_rules where category = 'Food')::int > 0,
    (select count(*) from public.category_corrections where category = 'Food')::int,
    (select count(*) from public.recurring_expenses where category = 'Food')::int,
    (select count(*) from public.categories where name = 'Groceries')::int$$,
  $$values (1, 1, true, 1, 1, 0)$$, 'renaming updates expenses, budget, rules, learned merchants and recurring expenses');
select results_eq($$select category from public.transactions where description = 'odd income'$$, $$values ('Groceries'::text)$$, 'income is left alone');
select throws_like($$select public.rename_category('Food', 'Fuel')$$, 'There is already a category%', 'renaming onto an existing name is refused');
select throws_like($$select public.rename_category('Food', 'Income')$$, 'Choose another name%', '"Income" is reserved');
select throws_like($$select public.delete_category('Food')$$, '%still used by transactions%', 'deleting a used category needs a category to move things to');
select lives_ok($$select public.delete_category('Food', 'Leisure')$$, 'deleting with a category to move things to works');
select results_eq($$select
    (select count(*) from public.transactions where category = 'Leisure' and description = 'bob groceries')::int,
    (select count(*) from public.budgets where category in ('Food', 'Leisure'))::int,
    (select count(*) from public.recurring_expenses where category = 'Leisure')::int,
    (select count(*) from public.categories where name = 'Food')::int$$,
  $$values (1, 0, 1, 0)$$, 'its transactions and recurring expenses moved, its budget is gone');
select lives_ok($$select public.delete_category('Education')$$, 'an unused category can be deleted outright');
select is_empty($$select * from public.keyword_rules where category = 'Education'$$, 'its keyword rules go with it');
reset role;

-- Bob's changes didn't touch Alice's categories.
select results_eq(format($$select count(*)::int from public.categories where user_id = %L and name in ('Groceries', 'Education')$$, :'alice'),
  array[2], 'renaming and deleting only affect the user''s own categories');

-- ---- deactivated accounts can't use the functions either ----
select pg_temp.act_as(:'dave');
set local role authenticated;
select throws_ok($$select public.rename_category('Gym', 'Sport')$$, '42501', null, 'a deactivated user cannot rename categories');
select throws_ok($$select public.import_snapshot('{"transactions": []}')$$, '42501', null, 'a deactivated user cannot import');
select throws_ok($$select public.add_recurring_occurrences('[]')$$, '42501', null, 'a deactivated user cannot generate recurring expenses');
reset role;

select * from finish();
rollback;
