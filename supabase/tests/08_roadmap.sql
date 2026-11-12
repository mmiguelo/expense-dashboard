begin;
\ir _helpers.psql
select plan(6);

select pg_temp.new_user('admin@test.local') as admin \gset
select pg_temp.new_user('member@test.local') as member \gset
update public.profiles set role = 'admin' where id = :'admin';
select count(*)::int as seeded from public.roadmap_items \gset

select pg_temp.act_as(:'admin');
set local role authenticated;
select results_eq('select count(*)::int from public.roadmap_items', format('values (%s)', :seeded), 'admins see the roadmap');
select lives_ok($$insert into public.roadmap_items (text) values ('Try something')$$, 'admins add items');
select lives_ok($$update public.roadmap_items set done = true where text = 'Try something'$$, 'and tick them off');
reset role;

select pg_temp.act_as(:'member');
set local role authenticated;
select is_empty('select * from public.roadmap_items', 'members see nothing of it');
select throws_ok($$insert into public.roadmap_items (text) values ('Sneaky')$$, '42501', null, 'members cannot add to it');
update public.roadmap_items set done = false;
reset role;
select results_eq($$select done from public.roadmap_items where text = 'Try something'$$, 'values (true)', 'members cannot change it');

select * from finish();
rollback;
