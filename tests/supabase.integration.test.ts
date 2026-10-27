import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../src/categories';
import { generateRecurring } from '../src/recurring';
import { SupabaseRepository } from '../src/storage/supabaseRepository';
import type { Transaction } from '../src/types';

// Runs against a real Supabase instance with the migrations applied, e.g. the local one:
//   npm run db:start
//   SUPABASE_TEST_URL=http://127.0.0.1:54321 SUPABASE_TEST_ANON_KEY=<publishable key> npm run test:db
// Users sign up like real users; the service role key is never used. Skipped without the
// variables, so `npm test` and CI don't need a database.

const URL = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_ANON_KEY;

const client = () => createClient(URL!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

async function signUp(): Promise<{ db: SupabaseClient; id: string; email: string; password: string }> {
  const db = client();
  const email = `test-${crypto.randomUUID()}@example.test`;
  const password = 'correct-horse-battery';
  const { data, error } = await db.auth.signUp({ email, password });
  if (error || !data.session) throw error ?? new Error('Sign-up needs email confirmations off (they are, locally).');
  return { db, id: data.user!.id, email, password };
}

/** Another "device" signed in as the same user. */
async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const db = client();
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return db;
}

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

describe.skipIf(!URL || !KEY)('SupabaseRepository against a real database', () => {
  describe('repository', () => {
    let repo: SupabaseRepository;
    beforeAll(async () => {
      repo = new SupabaseRepository((await signUp()).db);
      await repo.initialize();
    });

    it('gives a new account the default categories, once', async () => {
      await repo.initialize();
      expect(await repo.getCategories()).toEqual(DEFAULT_CATEGORIES);
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
      // Undo puts it back with the same id.
      await repo.saveTransaction(a);
      expect((await repo.listTransactions()).map((x) => x.id)).toEqual([b.id, a.id]);
    });

    it('rounds amounts to cents', async () => {
      const t = tx({ amount: 1.005 });
      await repo.saveTransaction(t);
      expect((await repo.listTransactions()).find((x) => x.id === t.id)!.amount).toBe(1.01);
    });

    it('stores budgets, categories and learned categories', async () => {
      await repo.setBudget('Gym', 40);
      await repo.setBudget('Fuel', 70.5);
      await repo.setBudget('Gym', 45);
      await repo.setBudget('Fuel', null);
      expect(await repo.getBudgets()).toEqual({ Gym: 45 });

      await repo.saveCategory('Pets', '#c05299');
      const cats = Object.keys(await repo.getCategories());
      expect(cats.at(-1)).toBe('Pets');

      await repo.learnCategory('Kiosk Central', 'Leisure');
      await repo.learnCategory('kiosk central', 'Shopping');
      expect(await repo.getLearnedCategories()).toEqual({ 'kiosk central': 'Shopping' });
    });

    it('lists more than one page of transactions', async () => {
      const ex = Array.from({ length: 1205 }, (_, i) => tx({ id: `bulk-${i}`, desc: `Bulk ${i}` }));
      await repo.importSnapshot({ ex }, { replace: true });
      const all = await repo.listTransactions();
      expect(all).toHaveLength(1205);
      expect(all[0]!.desc).toBe('Bulk 0');
      expect(all[1204]!.desc).toBe('Bulk 1204');
    });
  });

  describe('recurring expenses', () => {
    it('generates each month once, even from two devices at the same time', async () => {
      const user = await signUp();
      const laptop = new SupabaseRepository(user.db);
      const phone = new SupabaseRepository(await signIn(user.email, user.password));
      const rule = { id: crypto.randomUUID(), desc: 'Gym', amount: 35, cat: 'Gym', day: 31, start: '2026-01' };
      await laptop.saveRecurring(rule);

      // Both devices see nothing generated yet and generate the same months, concurrently.
      const due = () => generateRecurring([rule], {}, '2026-04-30', () => crypto.randomUUID());
      await Promise.all([laptop.addGeneratedRecurring(due()), phone.addGeneratedRecurring(due()), laptop.addGeneratedRecurring(due())]);

      const txs = await phone.listTransactions();
      expect(txs.map((t) => t.date).sort()).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
      expect(txs.every((t) => t.fixed === 1 && t.tags === 'recurring')).toBe(true);
      expect(await laptop.getGeneratedMonths()).toEqual({
        [`${rule.id}2026-01`]: 1,
        [`${rule.id}2026-02`]: 1,
        [`${rule.id}2026-03`]: 1,
        [`${rule.id}2026-04`]: 1,
      });
    });

    it("doesn't bring back a deleted occurrence", async () => {
      const repo = new SupabaseRepository((await signUp()).db);
      const rule = { id: crypto.randomUUID(), desc: 'Rent', amount: 500, cat: 'Mortgage', day: 1, start: '2026-03' };
      await repo.saveRecurring(rule);
      await repo.addGeneratedRecurring(generateRecurring([rule], {}, '2026-03-05', () => crypto.randomUUID()));
      const [generated] = await repo.listTransactions();
      await repo.deleteTransaction(generated!.id);
      const again = generateRecurring([rule], await repo.getGeneratedMonths(), '2026-03-05', () => crypto.randomUUID());
      expect(again).toEqual([]);
      await repo.addGeneratedRecurring(generateRecurring([rule], {}, '2026-03-05', () => crypto.randomUUID()));
      expect(await repo.listTransactions()).toEqual([]);
    });

    it('keeps past transactions when a recurring expense is deleted', async () => {
      const repo = new SupabaseRepository((await signUp()).db);
      const rule = { id: crypto.randomUUID(), desc: 'Rent', amount: 500, cat: 'Mortgage', day: 1, start: '2026-03' };
      await repo.saveRecurring(rule);
      await repo.addGeneratedRecurring(generateRecurring([rule], {}, '2026-03-05', () => crypto.randomUUID()));
      await repo.deleteRecurring(rule.id);
      expect(await repo.listRecurring()).toEqual([]);
      expect(await repo.listTransactions()).toHaveLength(1);
    });
  });

  describe('importing local data', () => {
    const local = {
      ex: [
        { id: 1773828000000.123 as unknown as string, date: '2026-03-01', amount: 650, desc: 'Mortgage', cat: 'Mortgage', type: 'e' as const, tags: 'recurring', fixed: 1 as const },
        { id: '1773828000001.5', date: '2026-03-02', amount: 20, desc: 'Lidl', cat: 'Groceries', type: 'e' as const, tags: '' },
        { id: '1773828000002.5', date: '2026-03-02', amount: 7, desc: 'Kebab', cat: 'Takeaway', type: 'e' as const, tags: '' },
      ],
      rec: [{ id: 'r1773828000000', desc: 'Mortgage', amount: 650, cat: 'Mortgage', day: 1, start: '2026-03' }],
      gen: { 'r17738280000002026-03': 1 as const },
      bud: { Groceries: 100 },
      cats: { ...DEFAULT_CATEGORIES, Takeaway: '#c05299' },
      learn: { lidl: 'Groceries' },
    };

    it('imports everything, and importing again adds nothing', async () => {
      const repo = new SupabaseRepository((await signUp()).db);
      await repo.initialize();
      expect(await repo.importSnapshot(local, { replace: false })).toEqual({ transactions: 3, skipped: 0 });
      expect(await repo.importSnapshot(local, { replace: false })).toEqual({ transactions: 0, skipped: 3 });

      expect((await repo.listTransactions()).map((t) => t.desc)).toEqual(['Mortgage', 'Lidl', 'Kebab']);
      expect(await repo.getBudgets()).toEqual({ Groceries: 100 });
      expect(Object.keys(await repo.getCategories()).at(-1)).toBe('Takeaway');
      expect(await repo.getLearnedCategories()).toEqual({ lidl: 'Groceries' });

      // The imported recurring expense knows March is done, so it isn't generated again.
      const [rule] = await repo.listRecurring();
      expect(generateRecurring([rule!], await repo.getGeneratedMonths(), '2026-03-20', () => crypto.randomUUID())).toEqual([]);
    });

    it("re-importing the account's own JSON export adds nothing", async () => {
      const repo = new SupabaseRepository((await signUp()).db);
      await repo.initialize();
      await repo.saveTransaction(tx());
      const backup = await repo.exportSnapshot();
      expect(await repo.importSnapshot(backup, { replace: false })).toEqual({ transactions: 0, skipped: 1 });
      expect(await repo.listTransactions()).toHaveLength(1);
    });

    it('a replace import swaps the data', async () => {
      const repo = new SupabaseRepository((await signUp()).db);
      await repo.initialize();
      await repo.saveTransaction(tx({ desc: 'Before' }));
      await repo.setBudget('Gym', 10);
      await repo.importSnapshot(local, { replace: true });
      expect((await repo.listTransactions()).map((t) => t.desc)).toEqual(['Mortgage', 'Lidl', 'Kebab']);
      expect(await repo.getBudgets()).toEqual({ Groceries: 100 });
    });
  });

  describe('two users cannot see or change each other’s data', () => {
    let alice: Awaited<ReturnType<typeof signUp>>;
    let bob: Awaited<ReturnType<typeof signUp>>;
    let aliceTx: Transaction;
    let aliceRule: string;

    beforeAll(async () => {
      alice = await signUp();
      bob = await signUp();
      const a = new SupabaseRepository(alice.db);
      await a.initialize();
      aliceTx = tx({ desc: 'Alice secret' });
      await a.saveTransaction(aliceTx);
      aliceRule = crypto.randomUUID();
      await a.saveRecurring({ id: aliceRule, desc: 'Alice rent', amount: 900, cat: 'Mortgage', day: 1, start: '2026-01' });
      await a.setBudget('Groceries', 300);
      await a.learnCategory('alice shop', 'Shopping');
      await a.addGeneratedRecurring(generateRecurring([{ id: aliceRule, desc: 'Alice rent', amount: 900, cat: 'Mortgage', day: 1, start: '2026-01' }], {}, '2026-01-02', () => crypto.randomUUID()));
      await new SupabaseRepository(bob.db).initialize();
    });

    it('Bob reads none of Alice’s rows, in any table', async () => {
      for (const table of ['transactions', 'categories', 'budgets', 'recurring_expenses', 'recurring_occurrences', 'category_corrections']) {
        const { data, error } = await bob.db.from(table).select('user_id');
        expect(error, table).toBeNull();
        expect(data!.every((r) => r.user_id === bob.id), table).toBe(true);
      }
      const { data } = await bob.db.from('transactions').select().eq('id', aliceTx.id);
      expect(data).toEqual([]);
      const repo = new SupabaseRepository(bob.db);
      expect(await repo.listTransactions()).toEqual([]);
      expect(await repo.getBudgets()).toEqual({});
    });

    it('Bob cannot update or delete Alice’s rows (0 rows affected)', async () => {
      const upd = await bob.db.from('transactions').update({ amount: 1 }).eq('id', aliceTx.id).select();
      expect(upd.data).toEqual([]);
      const del = await bob.db.from('transactions').delete().eq('id', aliceTx.id).select();
      expect(del.data).toEqual([]);
      const delAll = await bob.db.from('budgets').delete().neq('category', '').select();
      expect(delAll.data).toEqual([]);
      const delRule = await bob.db.from('recurring_expenses').delete().eq('id', aliceRule).select();
      expect(delRule.data).toEqual([]);
    });

    it('Bob cannot write rows owned by Alice', async () => {
      const insert = await bob.db.from('transactions').insert({ ...{ date: '2026-01-01', amount: 1, type: 'expense', category: 'X' }, user_id: alice.id });
      expect(insert.error?.code).toBe('42501'); // row-level security violation

      // Overwriting Alice's transaction by reusing its id.
      const upsert = await bob.db.from('transactions').upsert({ id: aliceTx.id, date: '2026-01-01', amount: 1, type: 'expense', category: 'X' });
      expect(upsert.error).not.toBeNull();

      const move = await bob.db.from('budgets').update({ user_id: alice.id }).eq('category', 'Groceries').select();
      expect(move.data).toEqual([]);

      // Generating occurrences on Alice's recurring expense.
      const rpc = await bob.db.rpc('add_recurring_occurrences', {
        items: [{ recurring_id: aliceRule, month: '2026-02-01', id: crypto.randomUUID(), date: '2026-02-01', amount: 1, category: 'X', description: 'x' }],
      });
      expect(rpc.error).not.toBeNull();
    });

    it('Alice’s data is unchanged after all of that', async () => {
      const a = new SupabaseRepository(alice.db);
      expect(await a.listTransactions()).toEqual(expect.arrayContaining([aliceTx]));
      expect(await a.getBudgets()).toEqual({ Groceries: 300 });
      expect(await a.listRecurring()).toHaveLength(1);
      expect(Object.keys(await a.getGeneratedMonths())).toEqual([`${aliceRule}2026-01`]);
    });

    it('signed-out requests get nothing', async () => {
      const anon = client();
      const { data, error } = await anon.from('transactions').select();
      expect(data ?? []).toEqual([]);
      expect(error?.code).toBe('42501'); // permission denied: anon has no grants
      const rpc = await anon.rpc('import_snapshot', { payload: {}, replace_existing: true });
      expect(rpc.error).not.toBeNull();
    });
  });
});
