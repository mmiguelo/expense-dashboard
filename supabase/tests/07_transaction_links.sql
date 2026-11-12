begin;
\ir _helpers.psql
select plan(9);

select pg_temp.new_user('alice@test.local') as alice \gset
select pg_temp.new_user('bob@test.local') as bob \gset

select pg_temp.act_as(:'alice');
set local role authenticated;
insert into public.transactions (id, date, amount, type, category, reimbursable) values
  ('00000000-0000-0000-0000-0000000000a1', '2026-03-01', 20, 'expense', 'Lazer', true),
  ('00000000-0000-0000-0000-0000000000a2', '2026-03-02', 30, 'expense', 'Lazer', true),
  ('00000000-0000-0000-0000-0000000000b1', '2026-03-10', -45, 'expense', 'Lazer', false),
  ('00000000-0000-0000-0000-0000000000c1', '2026-03-10', 99, 'income', 'Rendimentos', false);

select lives_ok($$select public.set_transaction_links('00000000-0000-0000-0000-0000000000b1',
  '[{"purchase_id":"00000000-0000-0000-0000-0000000000a1","amount":20},{"purchase_id":"00000000-0000-0000-0000-0000000000a2","amount":25}]')$$,
  'one repayment settles two purchases, one of them partly');
select results_eq('select count(*)::int from public.transaction_links', 'values (2)', 'both links are saved');
select lives_ok($$select public.set_transaction_links('00000000-0000-0000-0000-0000000000b1',
  '[{"purchase_id":"00000000-0000-0000-0000-0000000000a1","amount":15}]')$$, 'links are replaced in one call');
select results_eq('select amount from public.transaction_links', 'values (15::numeric)', 'only the new link remains');

-- Each check runs at commit, so wrap them in a subtransaction that forces the check.
create function pg_temp.try_links(repayment uuid, items jsonb) returns void language plpgsql as $$
begin
  perform public.set_transaction_links(repayment, items);
  set constraints all immediate;
end $$;
select throws_ok($$select pg_temp.try_links('00000000-0000-0000-0000-0000000000b1', '[{"purchase_id":"00000000-0000-0000-0000-0000000000a1","amount":46}]')$$,
  '23514', null, 'a repayment cannot settle more than its amount');
select throws_ok($$select pg_temp.try_links('00000000-0000-0000-0000-0000000000c1', '[{"purchase_id":"00000000-0000-0000-0000-0000000000a1","amount":5}]')$$,
  '23514', null, 'income cannot settle a purchase');
select throws_ok($$select pg_temp.try_links('00000000-0000-0000-0000-0000000000b1', '[{"purchase_id":"00000000-0000-0000-0000-0000000000c1","amount":5}]')$$,
  '23514', null, 'only expenses can be settled');
reset role;

select pg_temp.act_as(:'bob');
set local role authenticated;
select results_eq('select count(*)::int from public.transaction_links', 'values (0)', 'links are private');
reset role;

select pg_temp.act_as(:'alice');
set local role authenticated;
delete from public.transactions where id = '00000000-0000-0000-0000-0000000000b1';
select results_eq('select count(*)::int from public.transaction_links', 'values (0)', 'deleting the repayment removes its links');
reset role;

select * from finish();
rollback;
