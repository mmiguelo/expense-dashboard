import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_STORAGE_KEY, LegacyLocalStore, STORAGE_KEY } from '../src/storage/legacyLocalStore';

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

const storageWith = (items: Record<string, unknown>) => {
  const s = new MemoryStorage();
  for (const [k, v] of Object.entries(items)) s.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  return s;
};

const tx = (id: unknown, cat = 'Groceries') => ({ id, date: '2026-03-01', amount: 10, desc: 'Lidl', cat, type: 'e', tags: '' });

describe('LegacyLocalStore', () => {
  it('has nothing to import in a fresh browser', () => {
    const store = new LegacyLocalStore(new MemoryStorage());
    expect(store.hasData()).toBe(false);
    expect(store.snapshot().ex).toEqual([]);
  });

  it('reads exp-v2 data, with old numeric ids as strings, keeping unknown keys', () => {
    const store = new LegacyLocalStore(storageWith({ [STORAGE_KEY]: { ex: [tx(1773828000000.123)], bud: { Gym: 30 }, cats: { Groceries: '#3fa66b' }, extra: 'kept' } }));
    const s = store.snapshot();
    expect(store.hasData()).toBe(true);
    expect(store.transactionCount).toBe(1);
    expect(s.ex[0]!.id).toBe('1773828000000.123');
    expect(s.bud).toEqual({ Gym: 30 });
    expect(s.cats).toEqual({ Groceries: '#3fa66b' });
    expect(s).toMatchObject({ extra: 'kept' });
  });

  it('reads expenses-v1 data as expenses, giving its categories colours', () => {
    const store = new LegacyLocalStore(storageWith({ [LEGACY_STORAGE_KEY]: [{ id: 1, date: '2025-01-01', amount: 5, desc: 'Old', cat: 'Fuel' }] }));
    const s = store.snapshot();
    expect(s.ex).toEqual([{ id: '1', date: '2025-01-01', amount: 5, desc: 'Old', cat: 'Fuel', type: 'e' }]);
    expect(Object.keys(s.cats)).toEqual(['Fuel']);
  });

  it('adds categories that transactions use but the saved list lacks', () => {
    const s = new LegacyLocalStore(storageWith({ [STORAGE_KEY]: { ex: [tx(1, 'Pets')], cats: { Groceries: '#3fa66b' } } })).snapshot();
    expect(Object.keys(s.cats)).toEqual(['Groceries', 'Pets']);
  });

  it('prefers exp-v2 over expenses-v1', () => {
    const s = new LegacyLocalStore(storageWith({ [STORAGE_KEY]: { ex: [tx(2)] }, [LEGACY_STORAGE_KEY]: [tx(1)] })).snapshot();
    expect(s.ex.map((x) => x.id)).toEqual(['2']);
  });

  it('treats corrupt data as nothing to import', () => {
    expect(new LegacyLocalStore(storageWith({ [STORAGE_KEY]: '{oops' })).hasData()).toBe(false);
  });

  it('never changes the saved data', () => {
    const s = storageWith({ [STORAGE_KEY]: { ex: [tx(1)] } });
    const before = s.getItem(STORAGE_KEY);
    const store = new LegacyLocalStore(s);
    store.snapshot().ex.pop();
    store.markImportedBy('user-a');
    expect(s.getItem(STORAGE_KEY)).toBe(before);
    expect(store.snapshot().ex).toHaveLength(1);
  });

  it('remembers which users imported its data', () => {
    const s = new MemoryStorage();
    new LegacyLocalStore(s).markImportedBy('user-a');
    expect(new LegacyLocalStore(s).wasImportedBy('user-a')).toBe(true);
    expect(new LegacyLocalStore(s).wasImportedBy('user-b')).toBe(false);
  });

  it('copes with storage that refuses writes', () => {
    const s = new MemoryStorage();
    s.failWrites = true;
    expect(() => new LegacyLocalStore(s).markImportedBy('user-a')).not.toThrow();
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

  it('no hardcoded default categories or keywords remain in the app', () => {
    const src = readdirSync('src', { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.ts'))
      .map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'))
      .join('\n');
    expect(src).not.toMatch(/pingo doce|continente|intermarch/i);
    expect(src).not.toMatch(/DEFAULT_CATEGORIES|CATEGORY_KEYWORDS/);
  });
});
