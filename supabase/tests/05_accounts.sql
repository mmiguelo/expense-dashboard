begin;
\ir _helpers.psql
select plan(9);

select pg_temp.new_user('alice@test.local') as alice \gset
select pg_temp.new_user('bob@test.local') as bob \gset

-- Every new user starts with one current account in their currency.
select results_eq(format($$select name, kind, currency, opening_balance from public.accounts where user_id = %L$$, :'alice'),
  $$values ('Conta principal'::text, 'checking'::text, 'EUR'::text, 0::numeric)$$, 'a new user gets one default current account');

select pg_temp.act_as(:'alice');
set local role authenticated;
insert into public.accounts (name, kind, opening_balance, institution) values ('Poupança', 'savings', 3000, 'Bank B');
select results_eq('select count(*)::int from public.accounts', 'values (2)', 'a user can add accounts');
update public.accounts set archived = true where name = 'Poupança';
select results_eq($$select archived from public.accounts where name = 'Poupança'$$, 'values (true)', 'a user can archive an account');
update public.accounts set deleted_at = now() where name = 'Poupança';
select isnt_empty($$select 1 from public.accounts where name = 'Poupança' and deleted_at is not null$$, 'a user can soft-delete an account');
select throws_ok($$insert into public.accounts (name, kind) values ('Card', 'debit')$$, '23514', null, 'the kind must be one of the four');
select throws_ok($$insert into public.accounts (name, kind) values ('  ', 'checking')$$, '23514', null, 'the name cannot be blank');
select throws_ok(format($$insert into public.accounts (user_id, name, kind) values (%L, 'Mine', 'checking')$$, :'bob'), '42501', null,
  'a user cannot add an account for someone else');
reset role;

select pg_temp.act_as(:'bob');
set local role authenticated;
select results_eq('select count(*)::int from public.accounts', 'values (1)', 'a user only sees their own accounts');
update public.accounts set name = 'Hacked' where user_id = :'alice';
reset role;
select results_eq(format($$select count(*)::int from public.accounts where user_id = %L and name = 'Hacked'$$, :'alice'), 'values (0)',
  'a user cannot change someone else''s accounts');

select * from finish();
rollback;
