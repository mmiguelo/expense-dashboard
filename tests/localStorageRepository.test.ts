import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../src/categories';
import { LEGACY_STORAGE_KEY, LocalStorageRepository, STORAGE_KEY } from '../src/storage/localStorageRepository';
import type { Transaction } from '../src/types';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.m.set(k, v);
  }
}

const tx = (id: number, over: Partial<Transaction> = {}): Transaction => ({
  id: String(id),
  date: '2026-03-01',
  amount: 10,
  desc: 'Lidl',
  cat: 'Groceries',
  type: 'e',
  tags: '',
  ...over,
});

const stored = (s: Storage) => JSON.parse(s.getItem(STORAGE_KEY)!);

describe('LocalStorageRepository', () => {
  it('starts empty with the default categories', async () => {
    const repo = new LocalStorageRepository(new MemoryStorage());
    expect(await repo.listTransactions()).toEqual([]);
    expect(await repo.getCategories()).toEqual(DEFAULT_CATEGORIES);
    expect(await repo.exportSnapshot()).toEqual({ ex: [], rec: [], bud: {}, cats: DEFAULT_CATEGORIES, learn: {}, gen: {} });
  });

  it('reads existing exp-v2 data, keeping defaults for missing parts and unknown keys', async () => {
    const s = new MemoryStorage();
    s.setItem(STORAGE_KEY, JSON.stringify({ ex: [tx(1)], bud: { Gym: 30 }, extra: 'kept' }));
    const repo = new LocalStorageRepository(s);
    expect(await repo.listTransactions()).toEqual([tx(1)]);
    expect(await repo.getBudgets()).toEqual({ Gym: 30 });
    expect(await repo.getCategories()).toEqual(DEFAULT_CATEGORIES);
    expect(await repo.exportSnapshot()).toMatchObject({ extra: 'kept' });
  });

  it('migrates expenses-v1 data as expenses when exp-v2 is absent', async () => {
    const s = new MemoryStorage();
    s.setItem(LEGACY_STORAGE_KEY, JSON.stringify([{ id: 1, date: '2025-01-01', amount: 5, desc: 'Old', cat: 'Fuel' }]));
    const repo = new LocalStorageRepository(s);
    expect(await repo.listTransactions()).toEqual([{ id: '1', date: '2025-01-01', amount: 5, desc: 'Old', cat: 'Fuel', type: 'e' }]);
    // The old key is left alone; the first change writes the new key.
    await repo.setBudget('Fuel', 50);
    expect(stored(s).ex).toHaveLength(1);
    expect(s.getItem(LEGACY_STORAGE_KEY)).not.toBeNull();
  });

  it('prefers exp-v2 over expenses-v1', async () => {
    const s = new MemoryStorage();
    s.setItem(STORAGE_KEY, JSON.stringify({ ex: [tx(2)] }));
    s.setItem(LEGACY_STORAGE_KEY, JSON.stringify([tx(1)]));
    expect((await new LocalStorageRepository(s).listTransactions()).map((x) => x.id)).toEqual(['2']);
  });

  it('falls back to defaults when stored data is corrupt', async () => {
    const s = new MemoryStorage();
    s.setItem(STORAGE_KEY, '{oops');
    expect(await new LocalStorageRepository(s).listTransactions()).toEqual([]);
  });

  it('persists changes in the exp-v2 format, readable by a new instance', async () => {
    const s = new MemoryStorage();
    const repo = new LocalStorageRepository(s);
    await repo.saveTransaction(tx(1));
    await repo.saveRecurring({ id: 'r1', desc: 'Gym', amount: 30, cat: 'Gym', day: 31, start: '2026-01' });
    await repo.setBudget('Gym', 40);
    await repo.saveCategory('Pets', '#c05299');
    await repo.learnCategory('Lidl', 'Leisure');
    await repo.addGeneratedRecurring([{ recurringId: 'r1', month: '2026-01', transaction: tx(2, { fixed: 1, tags: 'recurring' }) }]);

    expect(Object.keys(stored(s))).toEqual(['ex', 'rec', 'bud', 'cats', 'learn', 'gen']);
    const again = new LocalStorageRepository(s);
    expect((await again.listTransactions()).map((x) => x.id)).toEqual(['1', '2']);
    expect(await again.listRecurring()).toHaveLength(1);
    expect(await again.getBudgets()).toEqual({ Gym: 40 });
    expect((await again.getCategories()).Pets).toBe('#c05299');
    expect(await again.getLearnedCategories()).toEqual({ lidl: 'Leisure' });
    expect(await again.getGeneratedMonths()).toEqual({ 'r12026-01': 1 });
  });

  it('updates a transaction in place and appends new ones', async () => {
    const repo = new LocalStorageRepository(new MemoryStorage());
    await repo.saveTransaction(tx(1));
    await repo.saveTransaction(tx(2));
    await repo.saveTransaction(tx(1, { amount: 99 }));
    expect((await repo.listTransactions()).map((x) => [x.id, x.amount])).toEqual([
      ['1', 99],
      ['2', 10],
    ]);
  });

  it('deletes transactions and recurring expenses', async () => {
    const repo = new LocalStorageRepository(new MemoryStorage());
    await repo.saveTransaction(tx(1));
    await repo.saveTransaction(tx(2));
    await repo.deleteTransaction('1');
    expect((await repo.listTransactions()).map((x) => x.id)).toEqual(['2']);
    await repo.saveRecurring({ id: 'r1', desc: 'Gym', amount: 30, cat: 'Gym', day: 1, start: '2026-01' });
    await repo.deleteRecurring('r1');
    expect(await repo.listRecurring()).toEqual([]);
  });

  it('removes a budget when set to null or 0', async () => {
    const repo = new LocalStorageRepository(new MemoryStorage());
    await repo.setBudget('Gym', 40);
    await repo.setBudget('Gym', null);
    await repo.setBudget('Fuel', 40);
    await repo.setBudget('Fuel', 0);
    expect(await repo.getBudgets()).toEqual({});
  });

  it('reads old numeric ids as strings', async () => {
    const s = new MemoryStorage();
    s.setItem(STORAGE_KEY, JSON.stringify({ ex: [{ ...tx(1), id: 1773828000000.123 }] }));
    expect((await new LocalStorageRepository(s).listTransactions())[0]!.id).toBe('1773828000000.123');
  });

  it('skips generated months that are already marked', async () => {
    const repo = new LocalStorageRepository(new MemoryStorage());
    const occ = { recurringId: 'r1', month: '2026-01', transaction: tx(2) };
    await repo.addGeneratedRecurring([occ]);
    await repo.addGeneratedRecurring([{ ...occ, transaction: tx(3) }]);
    expect((await repo.listTransactions()).map((x) => x.id)).toEqual(['2']);
  });

  it('import with replace replaces the parts in the backup and keeps the rest', async () => {
    const repo = new LocalStorageRepository(new MemoryStorage());
    await repo.saveTransaction(tx(1));
    await repo.setBudget('Gym', 40);
    expect(await repo.importSnapshot({ ex: [tx(5)] }, { replace: true })).toEqual({ transactions: 1, skipped: 0 });
    expect((await repo.listTransactions()).map((x) => x.id)).toEqual(['5']);
    expect(await repo.getBudgets()).toEqual({ Gym: 40 });
  });

  it('import without replace merges and skips duplicates, so repeating it adds nothing', async () => {
    const repo = new LocalStorageRepository(new MemoryStorage());
    await repo.saveTransaction(tx(1));
    await repo.setBudget('Gym', 40);
    await repo.saveCategory('Groceries', '#000000');
    const backup = {
      ex: [{ ...tx(1), amount: 999 }, tx(2)],
      bud: { Gym: 10, Fuel: 20 },
      cats: { Groceries: '#ffffff', Pets: '#c05299' },
      rec: [{ id: 'r1', desc: 'Gym', amount: 30, cat: 'Gym', day: 1, start: '2026-01' }],
      gen: { 'r12026-01': 1 as const },
    };
    expect(await repo.importSnapshot(backup, { replace: false })).toEqual({ transactions: 1, skipped: 1 });
    expect(await repo.importSnapshot(backup, { replace: false })).toEqual({ transactions: 0, skipped: 2 });
    expect((await repo.listTransactions()).map((x) => [x.id, x.amount])).toEqual([
      ['1', 10],
      ['2', 10],
    ]);
    expect(await repo.getBudgets()).toEqual({ Gym: 40, Fuel: 20 });
    const cats = await repo.getCategories();
    expect([cats.Groceries, cats.Pets]).toEqual(['#000000', '#c05299']);
    expect(await repo.listRecurring()).toHaveLength(1);
    expect(await repo.getGeneratedMonths()).toEqual({ 'r12026-01': 1 });
  });

  it('remembers which users imported its data', () => {
    const s = new MemoryStorage();
    const repo = new LocalStorageRepository(s);
    expect(repo.hasData()).toBe(false);
    repo.markImportedBy('user-a');
    expect(new LocalStorageRepository(s).wasImportedBy('user-a')).toBe(true);
    expect(new LocalStorageRepository(s).wasImportedBy('user-b')).toBe(false);
  });

  it('returns copies, so callers cannot change stored data by mutation', async () => {
    const repo = new LocalStorageRepository(new MemoryStorage());
    await repo.saveTransaction(tx(1));
    (await repo.listTransactions())[0]!.amount = 1000;
    (await repo.getCategories()).Hacked = '#000';
    expect((await repo.listTransactions())[0]!.amount).toBe(10);
    expect((await repo.getCategories()).Hacked).toBeUndefined();
  });

  it('keeps working in memory when storage writes fail', async () => {
    const s = new MemoryStorage();
    s.failWrites = true;
    const repo = new LocalStorageRepository(s);
    await repo.saveTransaction(tx(1));
    expect(await repo.listTransactions()).toHaveLength(1);
  });
});

describe('storage boundary', () => {
  it('nothing outside src/storage touches localStorage', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (p !== join('src', 'storage')) walk(p);
        } else if (/\b(localStorage|sessionStorage)\b/.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });
});
