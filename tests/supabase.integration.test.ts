import { beforeAll, describe, expect, it, vi } from 'vitest';

// Real sign-ups with email confirmation take a few seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { generateRecurring } from '../src/recurring';
import { SupabaseAdminRepository } from '../src/storage/supabaseAdminRepository';
import { SupabaseRepository } from '../src/storage/supabaseRepository';
import type { Transaction } from '../src/types';
import { client, HAVE_DB, signIn, signUp, signUpAdmin, signUpUnconfirmed, sql, type TestUser } from './support/testUsers';

// Runs against a real Supabase with the migrations applied; see tests/support/testUsers.ts
// and the README for the variables. Skipped without them.

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: crypto.randomUUID(),
  date: '2026-03-02',
  amount: 12.5,
  desc: 'Lidl',
  cat: 'Groceries',
  type: 'e',
  tags: '',
  ...over,
});

const repoOf = (u: TestUser) => new SupabaseRepository(u.db, u.id);

describe.skipIf(!HAVE_DB)('against a real database', () => {
  describe('repository', () => {
    let user: TestUser;
    let repo: SupabaseRepository;
    beforeAll(async () => {
      user = await signUp();
      repo = repoOf(user);
    });

    it("reads the user's profile: a member, active", async () => {
      expect(await repo.getProfile()).toMatchObject({ id: user.id, email: user.email, role: 'member', active: true });
    });

    it('starts with the default categories and keyword rules, from the database', async () => {
      const defaults = await sql<{ name: string; color: string }>('select name, color from public.default_categories order by sort_order, id');
      expect(await repo.getCategories()).toEqual(Object.fromEntries(defaults.map((d) => [d.name, d.color])));
      const rules = await repo.listKeywordRules();
      const [{ n }] = await sql<{ n: number }>('select count(*)::int as n from public.default_keyword_rules');
      expect(rules).toHaveLength(n);
      expect(rules.find((r) => r.keyword === 'pingo doce')?.category).toBe('Groceries');
    });

    it('saves, updates, lists in insertion order and deletes transactions', async () => {
      const a = tx({ desc: 'First' });
      const b = tx({ desc: 'Second', type: 'i', cat: 'Income', tags: 'salary' });
      await repo.saveTransaction(a);
      await repo.saveTransaction(b);
      await repo.saveTransaction({ ...a, amount: 99.99, fixed: 1 });
      expect(await repo.listTransactions()).toEqual([{ ...a, amount: 99.99, fixed: 1 }, b]);
      await repo.deleteTransaction(a.id);
      expect(await repo.listTransactions()).toEqual([b]);
      await repo.saveTransaction(a);
      expect((await repo.listTransactions()).map((x) => x.id)).toEqual([b.id, a.id]);
    });

    it('stores budgets and learned categories', async () => {
      await repo.setBudget('Gym', 40);
      await repo.setBudget('Fuel', 70.5);
      await repo.setBudget('Fuel', null);
      expect(await repo.getBudgets()).toEqual({ Gym: 40 });
      await repo.learnCategory('Kiosk Central', 'Leisure');
      await repo.learnCategory('kiosk central', 'Shopping');
      expect(await repo.getLearnedCategories()).toEqual({ 'kiosk central': 'Shopping' });
    });

    it('adds, changes and deletes keyword rules', async () => {
      await repo.saveCategory('Pets', '#c05299');
      await repo.saveKeywordRule({ keyword: 'Vet Clinic', category: 'Pets' });
      let rule = (await repo.listKeywordRules()).at(-1)!;
      expect(rule).toMatchObject({ keyword: 'vet clinic', category: 'Pets' });
      await repo.saveKeywordRule({ ...rule, keyword: 'vet ' });
      rule = (await repo.listKeywordRules()).at(-1)!;
      expect(rule.keyword).toBe('vet ');
      await repo.deleteKeywordRule(rule.id!);
      expect((await repo.listKeywordRules()).some((r) => r.category === 'Pets')).toBe(false);
    });

    it('renames and deletes categories, keeping transactions consistent', async () => {
      const user2 = await signUp();
      const r = repoOf(user2);
      await r.saveTransaction(tx({ desc: 'Bread', cat: 'Groceries' }));
      await r.setBudget('Groceries', 200);
      await r.renameCategory('Groceries', 'Food');
      expect((await r.listTransactions())[0]!.cat).toBe('Food');
      expect(await r.getBudgets()).toEqual({ Food: 200 });
      expect((await r.listKeywordRules()).find((k) => k.keyword === 'lidl')?.category).toBe('Food');

      await expect(r.deleteCategory('Food', null)).rejects.toThrow(/still used/);
      await r.deleteCategory('Food', 'Shopping');
      expect((await r.listTransactions())[0]!.cat).toBe('Shopping');
      expect(await r.getBudgets()).toEqual({});
      expect('Food' in (await r.getCategories())).toBe(false);
    });

    it('lists more than one page of transactions', async () => {
      const ex = Array.from({ length: 1205 }, (_, i) => tx({ id: `bulk-${i}`, desc: `Bulk ${i}` }));
      await repo.importSnapshot({ ex }, { replace: true });
      const all = await repo.listTransactions();
      expect(all).toHaveLength(1205);
      expect(all[1204]!.desc).toBe('Bulk 1204');
    });

    it('refuses more than 120 new rows a minute, with a readable message', async () => {
      const r = repoOf(await signUp());
      await Promise.all(Array.from({ length: 120 }, () => r.saveTransaction(tx())));
      await expect(r.saveTransaction(tx())).rejects.toThrow(/Too many changes at once/);
    });
  });

  describe('recurring expenses', () => {
    it('generates each month once, even from two devices at the same time', async () => {
      const user = await signUp();
      const laptop = repoOf(user);
      const phone = new SupabaseRepository(await signIn(user.email), user.id);
      const rule = { id: crypto.randomUUID(), desc: 'Gym', amount: 35, cat: 'Gym', day: 31, start: '2026-01' };
      await laptop.saveRecurring(rule);
      const due = () => generateRecurring([rule], {}, '2026-04-30', () => crypto.randomUUID());
      await Promise.all([laptop.addGeneratedRecurring(due()), phone.addGeneratedRecurring(due()), laptop.addGeneratedRecurring(due())]);
      const txs = await phone.listTransactions();
      expect(txs.map((t) => t.date).sort()).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
      expect(Object.keys(await laptop.getGeneratedMonths())).toHaveLength(4);
    });

    it("doesn't bring back a deleted occurrence", async () => {
      const repo = repoOf(await signUp());
      const rule = { id: crypto.randomUUID(), desc: 'Rent', amount: 500, cat: 'Mortgage', day: 1, start: '2026-03' };
      await repo.saveRecurring(rule);
      await repo.addGeneratedRecurring(generateRecurring([rule], {}, '2026-03-05', () => crypto.randomUUID()));
      await repo.deleteTransaction((await repo.listTransactions())[0]!.id);
      await repo.addGeneratedRecurring(generateRecurring([rule], {}, '2026-03-05', () => crypto.randomUUID()));
      expect(await repo.listTransactions()).toEqual([]);
    });
  });

  describe('importing local data', () => {
    const local = {
      ex: [
        { id: '1773828000000.123', date: '2026-03-01', amount: 650, desc: 'Mortgage', cat: 'Mortgage', type: 'e' as const, tags: 'recurring', fixed: 1 as const },
        { id: '1773828000001.5', date: '2026-03-02', amount: 7, desc: 'Kebab', cat: 'Takeaway', type: 'e' as const, tags: '' },
      ],
      rec: [{ id: 'r1773828000000', desc: 'Mortgage', amount: 650, cat: 'Mortgage', day: 1, start: '2026-03' }],
      gen: { 'r17738280000002026-03': 1 as const },
      bud: { Groceries: 100 },
      cats: { Takeaway: '#c05299' },
      learn: { lidl: 'Groceries' },
    };

    it('imports everything, and importing again adds nothing', async () => {
      const repo = repoOf(await signUp());
      expect(await repo.importSnapshot(local, { replace: false })).toEqual({ transactions: 2, skipped: 0 });
      expect(await repo.importSnapshot(local, { replace: false })).toEqual({ transactions: 0, skipped: 2 });
      expect(Object.keys(await repo.getCategories()).at(-1)).toBe('Takeaway');
      const [rule] = await repo.listRecurring();
      expect(generateRecurring([rule!], await repo.getGeneratedMonths(), '2026-03-20', () => crypto.randomUUID())).toEqual([]);
    });

    it("an export, keyword rules included, re-imports into another account", async () => {
      const a = repoOf(await signUp());
      await a.saveTransaction(tx());
      await a.saveKeywordRule({ keyword: 'zzz shop', category: 'Shopping' });
      const backup = await a.exportSnapshot();
      expect(await a.importSnapshot(backup, { replace: false })).toEqual({ transactions: 0, skipped: 1 });

      const b = repoOf(await signUp());
      await b.importSnapshot(backup, { replace: true });
      expect(await b.listTransactions()).toHaveLength(1);
      expect((await b.listKeywordRules()).some((r) => r.keyword === 'zzz shop')).toBe(true);
    });
  });

  describe('members cannot see or change each other’s data', () => {
    let alice: TestUser;
    let bob: TestUser;
    let aliceTx: Transaction;

    beforeAll(async () => {
      [alice, bob] = await Promise.all([signUp('alice'), signUp('bob')]);
      aliceTx = tx({ desc: 'Alice secret' });
      await repoOf(alice).saveTransaction(aliceTx);
      await repoOf(alice).setBudget('Groceries', 300);
    });

    it('Bob reads none of Alice’s rows, in any table, and only his own profile', async () => {
      for (const table of ['transactions', 'categories', 'keyword_rules', 'budgets', 'recurring_expenses', 'recurring_occurrences', 'category_corrections']) {
        const { data, error } = await bob.db.from(table).select('user_id');
        expect(error, table).toBeNull();
        expect(data!.every((r) => r.user_id === bob.id), table).toBe(true);
      }
      const { data: profiles } = await bob.db.from('profiles').select('id, role, active');
      expect(profiles).toEqual([{ id: bob.id, role: 'member', active: true }]);
    });

    it('Bob cannot change, delete or take over Alice’s rows', async () => {
      expect((await bob.db.from('transactions').update({ amount: 1 }).eq('id', aliceTx.id).select()).data).toEqual([]);
      expect((await bob.db.from('transactions').delete().eq('id', aliceTx.id).select()).data).toEqual([]);
      const upsert = await bob.db.from('transactions').upsert({ id: aliceTx.id, date: '2026-01-01', amount: 1, type: 'expense', category: 'X' });
      expect(upsert.error).not.toBeNull();
      const insert = await bob.db.from('transactions').insert({ user_id: alice.id, date: '2026-01-01', amount: 1, type: 'expense', category: 'X' });
      expect(insert.error?.code).toBe('42501');
      expect(await repoOf(alice).listTransactions()).toEqual([aliceTx]);
    });

    it('a member cannot change roles or activation, their own or anyone’s', async () => {
      const own = await bob.db.from('profiles').update({ role: 'admin' }).eq('id', bob.id).select();
      expect(own.error?.message).toMatch(/only admins/);
      const other = await bob.db.from('profiles').update({ active: false }).eq('id', alice.id).select();
      expect(other.data ?? []).toEqual([]);
      const admin = new SupabaseAdminRepository(bob.db);
      expect(await admin.listProfiles()).toHaveLength(1);
      await expect(admin.updateProfile(alice.id, { active: false })).rejects.toThrow();
      await expect(admin.saveDefaultCategory({ name: 'Hacked', color: '#000000', sortOrder: 0 })).rejects.toThrow();
      expect((await sql('select active from public.profiles where id = $1', [alice.id]))[0]).toEqual({ active: true });
    });
  });

  describe('admin', () => {
    let admin: TestUser;
    let member: TestUser;
    beforeAll(async () => {
      [admin, member] = await Promise.all([signUpAdmin(), signUp('member')]);
      await repoOf(member).saveTransaction(tx({ desc: 'Member private' }));
      await repoOf(member).setBudget('Fuel', 50);
    });

    it("sees every account's info", async () => {
      const profiles = await new SupabaseAdminRepository(admin.db).listProfiles();
      expect(profiles.find((p) => p.id === member.id)).toMatchObject({ email: member.email, role: 'member', active: true });
    });

    it("cannot read a member's financial data, in any table", async () => {
      for (const table of ['transactions', 'categories', 'keyword_rules', 'budgets', 'recurring_expenses', 'recurring_occurrences', 'category_corrections']) {
        const { data } = await admin.db.from(table).select('user_id').eq('user_id', member.id);
        expect(data, table).toEqual([]);
      }
    });

    it('can change roles and names, but not their own role or activation', async () => {
      const repo = new SupabaseAdminRepository(admin.db);
      await repo.updateProfile(member.id, { displayName: 'Cousin', role: 'admin' });
      await repo.updateProfile(member.id, { role: 'member' });
      expect((await repo.listProfiles()).find((p) => p.id === member.id)).toMatchObject({ displayName: 'Cousin', role: 'member' });
      await expect(repo.updateProfile(admin.id, { role: 'member' })).rejects.toThrow(/own role/);
      await expect(repo.updateProfile(admin.id, { active: false })).rejects.toThrow(/deactivate your own/);
    });

    it('manages the defaults that new accounts get', async () => {
      const repo = new SupabaseAdminRepository(admin.db);
      const name = `Pets ${crypto.randomUUID().slice(0, 6)}`;
      await repo.saveDefaultCategory({ name, color: '#c05299', sortOrder: 999 });
      const created = (await repo.listDefaultCategories()).find((c) => c.name === name)!;
      const keyword = `vet-${crypto.randomUUID().slice(0, 6)}`;
      await repo.saveDefaultKeywordRule({ category: name, keyword });
      const newcomer = repoOf(await signUp());
      expect((await newcomer.getCategories())[name]).toBe('#c05299');
      expect((await newcomer.listKeywordRules()).find((r) => r.keyword === keyword)?.category).toBe(name);
      await repo.deleteDefaultCategory(created.id!);
      expect((await repo.listDefaultKeywordRules()).some((r) => r.keyword === keyword)).toBe(false);
      // Accounts that already have it keep it.
      expect((await newcomer.getCategories())[name]).toBe('#c05299');
    });
  });

  describe('deactivation', () => {
    it('locks a signed-in user out at once, keeps their data, and reactivation restores it', async () => {
      const [admin, user] = await Promise.all([signUpAdmin(), signUp('deact')]);
      const repo = repoOf(user);
      await repo.saveTransaction(tx({ desc: 'Kept' }));
      const adminRepo = new SupabaseAdminRepository(admin.db);

      await adminRepo.updateProfile(user.id, { active: false });
      // Same session (JWT) as before.
      expect(await repo.getProfile()).toMatchObject({ active: false });
      for (const table of ['transactions', 'categories', 'keyword_rules', 'budgets', 'recurring_expenses', 'recurring_occurrences', 'category_corrections', 'default_categories', 'default_keyword_rules']) {
        const { data } = await user.db.from(table).select('*');
        expect(data, table).toEqual([]);
      }
      await expect(repo.saveTransaction(tx())).rejects.toThrow();
      await expect(repo.importSnapshot({ ex: [tx()] }, { replace: false })).rejects.toThrow(/not active/);
      expect(await sql('select count(*)::int as n from public.transactions where user_id = $1', [user.id])).toEqual([{ n: 1 }]);

      await adminRepo.updateProfile(user.id, { active: true });
      expect((await repo.listTransactions()).map((t) => t.desc)).toEqual(['Kept']);
    });
  });

  describe('unconfirmed accounts', () => {
    it('get no session and cannot sign in until the email is confirmed', async () => {
      const { email, session, id } = await signUpUnconfirmed();
      expect(session).toBeNull();
      const { error } = await client().auth.signInWithPassword({ email, password: 'correct-horse-battery' });
      expect(error?.message).toMatch(/not confirmed/i);
      // The account exists, with its defaults, but nobody can reach it through the API.
      expect(await sql('select role, active from public.profiles where id = $1', [id])).toEqual([{ role: 'member', active: true }]);
    });

    it('signed-out requests get nothing', async () => {
      const anon = client();
      const { error } = await anon.from('transactions').select();
      expect(error?.code).toBe('42501');
      expect((await anon.from('profiles').select()).error?.code).toBe('42501');
      expect((await anon.rpc('import_snapshot', { payload: {} })).error).not.toBeNull();
    });
  });
});
