import { describe, expect, it } from 'vitest';
import { readSupabaseConfig } from '../src/config';
import { ruleFromRow, ruleToRow, toImportPayload, txFromRow, txToRow } from '../src/storage/supabaseRepository';
import type { RecurringExpense, Transaction } from '../src/types';

describe('row mapping', () => {
  it('round-trips transactions', () => {
    const tx: Transaction = { id: 'a', date: '2026-03-01', amount: 12.5, desc: 'Lidl', cat: 'Groceries', type: 'e', tags: 'x' };
    expect(txToRow(tx)).toEqual({ id: 'a', date: '2026-03-01', amount: 12.5, type: 'expense', category: 'Groceries', description: 'Lidl', tags: 'x', fixed: false });
    expect(txFromRow(txToRow(tx))).toEqual(tx);
    const fixed: Transaction = { ...tx, type: 'e', fixed: 1 };
    expect(txFromRow(txToRow(fixed))).toEqual(fixed);
    const income: Transaction = { ...tx, type: 'i', cat: 'Income' };
    expect(txToRow(income).type).toBe('income');
    expect(txFromRow(txToRow(income))).toEqual(income);
  });

  it('reads numeric amounts sent as strings', () => {
    expect(txFromRow({ ...txToRow({ id: 'a', date: '2026-03-01', amount: 1, desc: '', cat: 'X', type: 'e' }), amount: '12.30' as unknown as number }).amount).toBe(12.3);
  });

  it('round-trips recurring expenses, storing the month as its 1st', () => {
    const r: RecurringExpense = { id: 'r', desc: 'Gym', amount: 30, cat: 'Gym', day: 31, start: '2026-04' };
    expect(ruleToRow(r).start_month).toBe('2026-04-01');
    expect(ruleFromRow(ruleToRow(r))).toEqual(r);
  });
});

describe('toImportPayload', () => {
  it('maps a backup, keeping original ids as source_id', () => {
    const p = toImportPayload({
      ex: [{ id: 1773828000000.123 as unknown as string, date: '2026-03-01', amount: 5, desc: 'Old', cat: 'Fuel', type: 'e', fixed: 1 }],
      rec: [{ id: 'r1', desc: 'Gym', amount: 30, cat: 'Gym', day: 31, start: '2026-01' }],
      gen: { 'r12026-01': 1, 'r12026-02': 1 },
      bud: { Gym: 40 },
      cats: { Gym: '#e97a3b' },
      learn: { lidl: 'Groceries' },
    });
    expect(p).toEqual({
      transactions: [{ source_id: '1773828000000.123', date: '2026-03-01', amount: 5, type: 'expense', category: 'Fuel', description: 'Old', tags: '', fixed: true }],
      recurring: [{ source_id: 'r1', description: 'Gym', amount: 30, category: 'Gym', day: 31, start_month: '2026-01-01' }],
      occurrences: [
        { recurring_source_id: 'r1', month: '2026-01-01' },
        { recurring_source_id: 'r1', month: '2026-02-01' },
      ],
      budgets: [{ category: 'Gym', amount: 40 }],
      categories: [{ name: 'Gym', color: '#e97a3b' }],
      corrections: [{ merchant: 'lidl', category: 'Groceries' }],
    });
  });

  it('includes only the parts present, so a replace import keeps the rest', () => {
    expect(Object.keys(toImportPayload({ ex: [] }))).toEqual(['transactions']);
  });

  it('leaves out rows the database would reject', () => {
    const p = toImportPayload({
      ex: [
        { id: '1', date: '2026-3-1', amount: 5, desc: '', cat: 'X', type: 'e' },
        { id: '2', date: '2026-03-01', amount: 0, desc: '', cat: 'X', type: 'e' },
        { id: '3', date: '2026-03-01', amount: NaN, desc: '', cat: 'X', type: 'e' },
        { id: '4', date: '2026-03-01', amount: 5, desc: 'ok', cat: 'X', type: 'e' },
      ],
      bud: { Gym: 0 },
      cats: { Pets: 'red' },
    });
    expect(p.transactions!.map((t) => t.source_id)).toEqual(['4']);
    expect(p.budgets).toEqual([]);
    expect(p.categories).toEqual([{ name: 'Pets', color: '#9aa5b5' }]);
  });
});

describe('readSupabaseConfig', () => {
  const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.y`;

  it('reads the URL and the anon key', () => {
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'https://p.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('anon') })).toEqual({
      url: 'https://p.supabase.co',
      anonKey: jwt('anon'),
    });
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: 'sb_publishable_abc' }).anonKey).toBe('sb_publishable_abc');
  });

  it('fails clearly when not configured', () => {
    expect(() => readSupabaseConfig({})).toThrow(/not configured/);
  });

  it('refuses secret keys', () => {
    expect(() => readSupabaseConfig({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: jwt('service_role') })).toThrow(/secret/);
    expect(() => readSupabaseConfig({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: 'sb_secret_abc' })).toThrow(/secret/);
  });
});
