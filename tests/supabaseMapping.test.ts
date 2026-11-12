import { describe, expect, it } from 'vitest';
import { readSupabaseConfig } from '../src/config';
import { accountFromRow, accountToRow, ruleFromRow, ruleToRow, toImportPayload, txFromRow, txToRow } from '../src/storage/supabaseRepository';
import type { Account, RecurringExpense, Transaction } from '../src/types';

describe('row mapping', () => {
  it('round-trips transactions', () => {
    const tx: Transaction = { id: 'a', date: '2026-03-01', amount: 12.5, desc: 'Lidl', cat: 'Groceries', type: 'e', tags: 'x' };
    expect(txToRow(tx)).toEqual({
      id: 'a',
      date: '2026-03-01',
      amount: 12.5,
      type: 'expense',
      category: 'Groceries',
      subcategory: '',
      description: 'Lidl',
      tags: 'x',
      fixed: false,
      account_id: undefined,
      to_account_id: null,
      to_amount: null,
      reimbursable: false,
      deleted_at: null,
    });
    expect(txFromRow(txToRow(tx))).toEqual(tx);
    const fixed: Transaction = { ...tx, type: 'e', fixed: 1 };
    expect(txFromRow(txToRow(fixed))).toEqual(fixed);
    const withSub: Transaction = { ...tx, sub: 'Supermercado' };
    expect(txToRow(withSub).subcategory).toBe('Supermercado');
    expect(txFromRow(txToRow(withSub))).toEqual(withSub);
    const income: Transaction = { ...tx, type: 'i', cat: 'Rendimentos' };
    expect(txToRow(income).type).toBe('income');
    expect(txFromRow(txToRow(income))).toEqual(income);
    const transfer: Transaction = { ...tx, type: 't', cat: '', to: 'savings', toAmt: 12.5 };
    expect(txToRow(transfer)).toMatchObject({ type: 'transfer', category: null, to_account_id: 'savings', to_amount: 12.5 });
    expect(txFromRow(txToRow(transfer))).toEqual(transfer);
    const adjustment: Transaction = { ...tx, type: 'a', cat: '', amount: -3 };
    expect(txToRow(adjustment)).toMatchObject({ type: 'adjustment', category: null, to_account_id: null });
    expect(txFromRow(txToRow(adjustment))).toEqual(adjustment);
    const reimbursable: Transaction = { ...tx, reimb: 1, del: '2026-03-02T00:00:00Z' };
    expect(txFromRow(txToRow(reimbursable))).toEqual(reimbursable);
  });

  it('reads numeric amounts sent as strings', () => {
    expect(txFromRow({ ...txToRow({ id: 'a', date: '2026-03-01', amount: 1, desc: '', cat: 'X', type: 'e' }), amount: '12.30' as unknown as number }).amount).toBe(12.3);
  });

  it('round-trips recurring expenses, storing the month as its 1st', () => {
    const r: RecurringExpense = { id: 'r', desc: 'Gym', amount: 30, cat: 'Gym', day: 31, start: '2026-04' };
    expect(ruleToRow(r).start_month).toBe('2026-04-01');
    expect(ruleFromRow(ruleToRow(r))).toEqual(r);
    expect(ruleFromRow(ruleToRow({ ...r, sub: 'Desporto' }))).toEqual({ ...r, sub: 'Desporto' });
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
      transactions: [
        {
          source_id: '1773828000000.123',
          date: '2026-03-01',
          amount: 5,
          type: 'expense',
          category: 'Fuel',
          subcategory: '',
          description: 'Old',
          tags: '',
          fixed: true,
          account: '',
          to_account: '',
          to_amount: null,
          reimbursable: false,
          deleted_at: null,
        },
      ],
      recurring: [
        {
          source_id: 'r1',
          description: 'Gym',
          amount: 30,
          category: 'Gym',
          subcategory: '',
          day: 31,
          start_month: '2026-01-01',
          type: 'expense',
          reimbursable: false,
          account: '',
          to_account: '',
        },
      ],
      occurrences: [
        { recurring_source_id: 'r1', month: '2026-01-01' },
        { recurring_source_id: 'r1', month: '2026-02-01' },
      ],
      budgets: [{ category: 'Gym', amount: 40 }],
      categories: [{ name: 'Gym', color: '#e97a3b' }],
      corrections: [{ merchant: 'lidl', category: 'Groceries' }],
    });
  });

  it('includes keyword rules, lower-cased, skipping empty ones', () => {
    expect(
      toImportPayload({
        rules: [
          { keyword: 'Vet ', category: 'Pets' },
          { keyword: '', category: 'Pets' },
        ],
      }).keyword_rules,
    ).toEqual([{ keyword: 'vet ', category: 'Pets' }]);
  });

  it('includes subcategories, and puts income in Rendimentos', () => {
    const p = toImportPayload({
      ex: [{ id: '1', date: '2026-03-01', amount: 900, desc: 'Salary', cat: 'Income', type: 'i' }],
      subs: { Habitação: ['Água', '', 'Gás'] },
    });
    expect(p.subcategories).toEqual([
      { category: 'Habitação', name: 'Água' },
      { category: 'Habitação', name: 'Gás' },
    ]);
    expect(p.transactions![0]).toMatchObject({ type: 'income', category: 'Rendimentos', subcategory: '' });
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
    expect(p.categories).toEqual([{ name: 'Pets', color: '#a39b8b' }]);
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
    expect(() => readSupabaseConfig({})).toThrow(/não está configurado/);
  });

  it('refuses secret keys', () => {
    expect(() => readSupabaseConfig({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: jwt('service_role') })).toThrow(/secret/);
    expect(() => readSupabaseConfig({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: 'sb_secret_abc' })).toThrow(/secret/);
  });
});

describe('account rows', () => {
  it('round-trip, with numeric balances sent as strings', () => {
    const account: Account = {
      id: 'a',
      name: 'Poupança',
      kind: 'savings',
      currency: 'EUR',
      openingBalance: 3000,
      openingDate: '2026-11-01',
      institution: 'Bank B',
      archived: false,
    };
    expect(accountFromRow(accountToRow(account))).toEqual(account);
    expect(accountFromRow({ ...accountToRow(account), opening_balance: '12.30' as unknown as number }).openingBalance).toBe(12.3);
    const deleted = { ...account, deletedAt: '2026-11-12T10:00:00Z' };
    expect(accountFromRow(accountToRow(deleted))).toEqual(deleted);
  });
});

describe('toImportPayload with accounts', () => {
  it('turns the old savings type into a transfer to a savings account it adds', () => {
    const p = toImportPayload({
      ex: [{ id: 's1', date: '2026-11-11', amount: 300, desc: 'Poupança', cat: 'Poupança', type: 's' as Transaction['type'] }],
    });
    expect(p.accounts).toEqual([
      expect.objectContaining({ source_id: 'legacy-savings', name: 'Poupança', kind: 'savings', opening_date: '2026-11-11' }),
    ]);
    expect(p.transactions).toEqual([
      expect.objectContaining({ type: 'transfer', category: null, account: '', to_account: 'legacy-savings', to_amount: 300 }),
    ]);
  });

  it('keeps accounts, money back and adjustments, and drops what the database would reject', () => {
    const p = toImportPayload({
      accounts: [{ id: 'a1', name: 'Card', kind: 'credit', currency: 'EUR', openingBalance: -50, openingDate: '2026-01-01', institution: 'X', archived: false }],
      ex: [
        { id: '1', date: '2026-03-01', amount: -20, desc: 'Refund', cat: 'Fuel', type: 'e', acc: 'a1' },
        { id: '2', date: '2026-03-01', amount: -5, desc: 'Fix', cat: '', type: 'a', acc: 'a1' },
        { id: '3', date: '2026-03-01', amount: 5, desc: 'Nowhere', cat: '', type: 't', acc: 'a1' },
        { id: '4', date: '2026-03-01', amount: -5, desc: 'Bad', cat: 'Rendimentos', type: 'i' },
      ],
    });
    expect(p.accounts).toEqual([
      { source_id: 'a1', name: 'Card', kind: 'credit', currency: 'EUR', opening_balance: -50, opening_date: '2026-01-01', institution: 'X', archived: false, deleted_at: null },
    ]);
    expect(p.transactions!.map((x) => [x.source_id, x.type, x.amount, x.account])).toEqual([
      ['1', 'expense', -20, 'a1'],
      ['2', 'adjustment', -5, 'a1'],
    ]);
  });
});
