begin;
\ir _helpers.psql
select plan(14);

select pg_temp.new_user('alice@test.local') as alice \gset
select pg_temp.new_user('bob@test.local') as bob \gset
select id as bob_acc from public.accounts where user_id = :'bob' \gset

select pg_temp.act_as(:'alice');
set local role authenticated;
select id as main from public.accounts where name = 'Conta principal' \gset
insert into public.accounts (name, kind) values ('Poupança', 'savings');
select id as save from public.accounts where name = 'Poupança' \gset

-- Without an account, a transaction goes to the first one (older app versions, recurring).
insert into public.transactions (date, amount, type, category) values ('2026-03-01', 10, 'expense', 'Alimentação');
select results_eq('select account_id from public.transactions', format('values (%L::uuid)', :'main'), 'a transaction without an account goes to the first one');

select lives_ok(format($$insert into public.transactions (date, amount, type, account_id, to_account_id, to_amount) values ('2026-03-02', 300, 'transfer', %L, %L, 300)$$, :'main', :'save'),
  'a transfer between two accounts');
select lives_ok($$insert into public.transactions (date, amount, type, category) values ('2026-03-03', -20, 'expense', 'Alimentação')$$, 'money back is a negative expense');
select lives_ok($$insert into public.transactions (date, amount, type) values ('2026-03-03', -5, 'adjustment')$$, 'an adjustment has a signed amount and no category');
select lives_ok($$insert into public.transactions (date, amount, type, category, reimbursable) values ('2026-03-04', 20, 'expense', 'Lazer', true)$$, 'a purchase can be reimbursable');

select throws_ok(format($$insert into public.transactions (date, amount, type, account_id, to_account_id, to_amount) values ('2026-03-02', 1, 'transfer', %L, %L, 1)$$, :'main', :'main'),
  '23514', null, 'a transfer cannot go to the same account');
select throws_ok($$insert into public.transactions (date, amount, type) values ('2026-03-02', 1, 'transfer')$$, '23514', null, 'a transfer needs a destination');
select throws_ok(format($$insert into public.transactions (date, amount, type, category, to_account_id, to_amount) values ('2026-03-02', 1, 'expense', 'Lazer', %L, 1)$$, :'save'),
  '23514', null, 'only transfers have a destination');
select throws_ok($$insert into public.transactions (date, amount, type, category) values ('2026-03-02', 1, 'adjustment', 'Lazer')$$, '23514', null, 'adjustments have no category');
select throws_ok($$insert into public.transactions (date, amount, type) values ('2026-03-02', 1, 'expense')$$, '23514', null, 'expenses need a category');
select throws_ok($$insert into public.transactions (date, amount, type, category) values ('2026-03-02', -1, 'income', 'Rendimentos')$$, '23514', null, 'income is positive');
select throws_ok($$insert into public.transactions (date, amount, type, category, reimbursable) values ('2026-03-02', -1, 'expense', 'Lazer', true)$$, '23514', null, 'money back cannot be reimbursable');
select throws_ok(format($$insert into public.transactions (date, amount, type, category, account_id) values ('2026-03-02', 1, 'expense', 'Lazer', %L)$$, :'bob_acc'),
  '23503', null, 'a transaction cannot use someone else''s account');

-- Import: accounts by their original id, and transactions that refer to them.
select results_eq($$select (public.import_snapshot('{"accounts":[{"source_id":"x1","name":"Cartão refeição","kind":"restricted"}],
  "transactions":[{"source_id":"t1","date":"2026-04-01","amount":7.5,"type":"expense","category":"Alimentação","account":"x1"}]}'::jsonb) ->> 'transactions')::int$$,
  'values (1)', 'an import brings its accounts and links its transactions to them');
reset role;

select * from finish();
rollback;
