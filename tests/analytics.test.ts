import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  allocate,
  accountDeleteBlocker,
  categoryRows,
  frequentExpenses,
  heatmapDays,
  outstandingPurchases,
  overview,
  owedToYou,
  percentChange,
  periodSpan,
  projectedTotal,
  searchTransactions,
  summarize,
  topMerchants,
  totalsByCategory,
  trendBars,
  visibleTransactions,
} from '../src/analytics';
import type { Account, Transaction } from '../src/types';

let nextId = 1;
const tx = (date: string, amount: number, over: Partial<Transaction> = {}): Transaction => ({
  id: String(nextId++),
  date,
  amount,
  desc: over.cat ?? 'Lidl',
  cat: 'Groceries',
  type: 'e',
  ...over,
});
const income = (date: string, amount: number) => tx(date, amount, { type: 'i', cat: 'Income', desc: 'Salary' });

describe('totalsByCategory', () => {
  it('sums per category in first-seen order', () => {
    const by = totalsByCategory([tx('2026-01-01', 10), tx('2026-01-02', 5, { cat: 'Fuel' }), tx('2026-01-03', 2.5)]);
    expect(by).toEqual({ Groceries: 12.5, Fuel: 5 });
    expect(Object.keys(by)).toEqual(['Groceries', 'Fuel']);
  });
});

describe('summarize: daily, monthly and yearly totals', () => {
  const txs = [
    tx('2026-03-01', 10),
    tx('2026-03-15', 20, { cat: 'Fuel' }),
    tx('2026-03-15', 5),
    tx('2026-02-10', 40),
    tx('2025-12-31', 100),
    income('2026-03-01', 1000),
  ];

  it('totals the day', () => {
    const s = summarize(txs, '2026-03-15', 'day', '2026-03-20');
    expect(s.total).toBe(25);
    expect(s.expenses).toHaveLength(2);
    expect(s.previousTotal).toBe(0);
    expect(s.income).toBe(0);
  });

  it('totals the month, excluding income from spending', () => {
    const s = summarize(txs, '2026-03-15', 'month', '2026-03-20');
    expect(s.total).toBe(35);
    expect(s.income).toBe(1000);
    expect(s.previousTotal).toBe(40);
    expect(s.categories).toEqual([
      ['Fuel', 20],
      ['Groceries', 15],
    ]);
    expect(s.average).toBe(35 / 31);
    expect(s.net).toBe(965);
    expect(s.savingsRate).toBe(97);
  });

  it('totals the year and compares with the previous one', () => {
    const s = summarize(txs, '2026-03-15', 'year', '2026-03-20');
    expect(s.total).toBe(75);
    expect(s.previousTotal).toBe(100);
    expect(s.average).toBe(75 / 12);
  });

  it('compares January with the previous December', () => {
    expect(summarize(txs, '2026-01-20', 'month', '2026-03-20').previousTotal).toBe(100);
  });

  it('compares March 31 with February, not March 3', () => {
    // Shifting back a month goes to the 1st of February, never rolls over.
    expect(summarize(txs, '2026-03-31', 'month', '2026-03-31').previousTotal).toBe(40);
  });

  it('splits fixed (recurring) and variable spending', () => {
    const s = summarize([tx('2026-03-01', 75, { fixed: 1 }), tx('2026-03-02', 25)], '2026-03-01', 'month', '2026-03-20');
    expect(s.fixed).toBe(75);
    expect(s.variable).toBe(25);
    expect(s.fixedShare).toBe(75);
  });

  it('keeps transfers out of income and spending, and counts what moved into savings', () => {
    const acc = (id: string, kind: Account['kind']): Account =>
      ({ id, name: id, kind, currency: 'EUR', openingBalance: 0, openingDate: '2026-01-01', institution: '', archived: false });
    const accounts = [acc('main', 'checking'), acc('save', 'savings'), acc('save2', 'savings')];
    const transfer = (amount: number, from: string, to: string) => tx('2026-03-05', amount, { type: 't', cat: '', acc: from, to, toAmt: amount });
    const txs = [
      income('2026-03-01', 1000),
      tx('2026-03-02', 200),
      transfer(300, 'main', 'save'),
      transfer(50, 'save', 'main'),
      transfer(80, 'save', 'save2'),
      tx('2026-03-03', 40, { del: '2026-03-04T00:00:00Z' }),
    ];
    const s = summarize(txs, '2026-03-01', 'month', '2026-03-20', accounts);
    expect(s.total).toBe(200);
    expect(s.expenses).toHaveLength(1);
    expect(s.income).toBe(1000);
    expect(s.saved).toBe(250);
    expect(s.net).toBe(800);
    expect(s.savingsRate).toBe(80);
    expect(s.categories.map(([c]) => c)).toEqual(['Groceries']);
  });

  it('counts money back (negative expenses) against spending', () => {
    const s = summarize([tx('2026-03-02', 50), tx('2026-03-09', -20)], '2026-03-01', 'month', '2026-03-20');
    expect(s.total).toBe(30);
    expect(s.byCategory).toEqual({ Groceries: 30 });
  });

  it('has no savings rate without income and 0% fixed without spending', () => {
    const s = summarize([], '2026-03-01', 'month', '2026-03-20');
    expect(s.savingsRate).toBeNull();
    expect(s.fixedShare).toBe(0);
  });
});

describe('periodSpan', () => {
  it('uses the days in the month, including February and leap years', () => {
    expect(periodSpan('2026-04-10', 'month')).toBe(30);
    expect(periodSpan('2026-02-10', 'month')).toBe(28);
    expect(periodSpan('2028-02-10', 'month')).toBe(29);
    expect(periodSpan('2026-01-10', 'year')).toBe(12);
    expect(periodSpan('2026-01-10', 'day')).toBe(1);
  });
});

describe('projectedTotal', () => {
  it('extrapolates the current month from the days elapsed', () => {
    expect(projectedTotal(100, '2026-04-01', 'month', '2026-04-10')).toBe(300);
  });

  it('uses the real month length, e.g. 28 days in February', () => {
    expect(projectedTotal(140, '2026-02-01', 'month', '2026-02-14')).toBe(280);
  });

  it('equals the total on the last day of the month', () => {
    expect(projectedTotal(310, '2026-03-05', 'month', '2026-03-31')).toBe(310);
    expect(projectedTotal(300, '2026-04-05', 'month', '2026-04-30')).toBe(300);
  });

  it('extrapolates the current year from the months elapsed', () => {
    expect(projectedTotal(300, '2026-01-01', 'year', '2026-03-15')).toBe(1200);
  });

  it('is null for other periods and for day mode', () => {
    expect(projectedTotal(100, '2026-03-01', 'month', '2026-04-10')).toBeNull();
    expect(projectedTotal(100, '2025-04-01', 'month', '2026-04-10')).toBeNull();
    expect(projectedTotal(100, '2025-01-01', 'year', '2026-04-10')).toBeNull();
    expect(projectedTotal(100, '2026-04-10', 'day', '2026-04-10')).toBeNull();
  });
});

describe('percentChange', () => {
  it('rounds the change and flags increases', () => {
    expect(percentChange(150, 100)).toEqual({ percent: 50, isIncrease: true, showPlus: true });
    expect(percentChange(50, 100)).toEqual({ percent: -50, isIncrease: false, showPlus: false });
  });

  it('shows +0% when unchanged', () => {
    expect(percentChange(100, 100)).toEqual({ percent: 0, isIncrease: false, showPlus: true });
  });

  it('is null without a previous value', () => {
    expect(percentChange(100, 0)).toBeNull();
  });
});

describe('categoryRows: budgets and comparisons', () => {
  const txs = [tx('2026-03-02', 90), tx('2026-03-03', 50, { cat: 'Fuel' }), tx('2026-03-04', 10, { cat: 'Gym' }), tx('2026-02-02', 100)];
  const rows = (mode: 'day' | 'month' | 'year', ref = '2026-03-02') =>
    categoryRows(summarize(txs, ref, mode, '2026-03-20'), { Groceries: 100, Fuel: 40, Gym: 20, Health: 30 }, mode);

  it('flags budget status: ok up to 80%, near up to 100%, over above', () => {
    const r = rows('month');
    expect(r.map((x) => [x.cat, x.status, x.fill])).toEqual([
      ['Groceries', 'near', 0.9],
      ['Fuel', 'over', 1],
      ['Gym', 'ok', 0.5],
      ['Health', 'ok', 0],
    ]);
  });

  it('includes budgeted categories without spending, with no comparison', () => {
    const health = rows('month').find((x) => x.cat === 'Health')!;
    expect(health.spent).toBe(0);
    expect(health.showChange).toBe(false);
  });

  it('compares with the previous period', () => {
    const r = rows('month');
    expect(r[0]!.change).toEqual({ percent: -10, isIncrease: false, showPlus: false });
    expect(r[1]!.showChange).toBe(true);
    expect(r[1]!.change).toBeNull(); // new this month
  });

  it('multiplies monthly budgets by 12 in year mode', () => {
    expect(rows('year').find((x) => x.cat === 'Groceries')!.budget).toBe(1200);
  });

  it('ignores budgets in day mode and fills relative to the largest category', () => {
    const r = rows('day', '2026-03-03');
    expect(r.map((x) => [x.cat, x.budget, x.status, x.fill])).toEqual([['Fuel', 0, 'none', 1]]);
  });
});

describe('trendBars', () => {
  const txs = [tx('2026-03-01', 10), tx('2026-03-01', 5, { cat: 'Fuel' }), tx('2026-02-28', 7), tx('2025-03-01', 99)];

  it('has one bar per day of the month, labelled every 5 days', () => {
    const bars = trendBars(txs, '2026-03-10', 'month');
    expect(bars).toHaveLength(31);
    expect(bars.filter((b) => b.label).map((b) => b.label)).toEqual(['1', '6', '11', '16', '21', '26', '31']);
    expect(bars[0]).toEqual({ label: '1', byCategory: { Groceries: 10, Fuel: 5 }, total: 15 });
  });

  it('has 30 bars in a 30-day month', () => {
    expect(trendBars(txs, '2026-04-10', 'month')).toHaveLength(30);
  });

  it('shows the last 7 days across a month boundary in day mode', () => {
    const bars = trendBars(txs, '2026-03-02', 'day');
    expect(bars.map((b) => b.label)).toEqual(['24', '25', '26', '27', '28', '1', '2']);
    expect(bars.map((b) => b.total)).toEqual([0, 0, 0, 0, 7, 15, 0]);
  });

  it('has 12 monthly bars in year mode', () => {
    const bars = trendBars(txs, '2026-06-01', 'year');
    expect(bars.map((b) => b.label).join('')).toBe('JFMAMJJASOND');
    expect(bars[1]!.total).toBe(7);
    expect(bars[2]!.total).toBe(15);
  });
});

describe('heatmapDays', () => {
  it('has one cell per day of the month', () => {
    const days = heatmapDays([tx('2026-04-30', 3), tx('2026-04-30', 4)], '2026-04-01', 'month');
    expect(days).toHaveLength(30);
    expect(days[29]).toEqual({ date: '2026-04-30', total: 7 });
  });

  it('has 365 or 366 cells per year', () => {
    expect(heatmapDays([], '2026-01-01', 'year')).toHaveLength(365);
    const leap = heatmapDays([], '2028-01-01', 'year');
    expect(leap).toHaveLength(366);
    expect(leap[59]!.date).toBe('2028-02-29');
    expect(leap[365]!.date).toBe('2028-12-31');
  });

  it('is empty in day mode', () => {
    expect(heatmapDays([], '2026-01-01', 'day')).toEqual([]);
  });
});

describe('topMerchants and frequentExpenses', () => {
  const txs = [
    tx('2026-03-01', 10, { desc: 'Lidl' }),
    tx('2026-03-02', 30, { desc: 'lidl' }),
    tx('2026-03-03', 25, { desc: 'Galp', cat: 'Fuel' }),
    tx('2026-03-04', 5, { desc: 'Café' }),
  ];

  it('groups merchants case-insensitively, largest spend first', () => {
    expect(topMerchants(txs)).toEqual([
      { name: 'Lidl', total: 40, count: 2 },
      { name: 'Galp', total: 25, count: 1 },
      { name: 'Café', total: 5, count: 1 },
    ]);
    expect(topMerchants(txs, 1)).toHaveLength(1);
  });

  it('suggests the most frequent descriptions with the latest amount', () => {
    expect(frequentExpenses(txs)[0]).toEqual({ desc: 'Lidl', cat: 'Groceries', amount: 30 });
  });
});

describe('searchTransactions', () => {
  const txs = [
    tx('2026-03-01', 12.5, { desc: 'Pingo Doce', tags: 'shared' }),
    tx('2026-03-05', 40, { desc: 'Galp', cat: 'Fuel' }),
    tx('2026-03-05', 8, { desc: 'Padaria' }),
    tx('2026-02-01', 9, { desc: 'Pingo Doce' }),
  ];

  it('returns the period newest first; on the same date, the one added last first', () => {
    expect(searchTransactions(txs, '2026-03-10', 'month', '', '').map((x) => x.desc)).toEqual(['Padaria', 'Galp', 'Pingo Doce']);
  });

  it('matches description, tags, amount and category, case-insensitively', () => {
    const q = (s: string) => searchTransactions(txs, '2026-03-10', 'month', s, '').map((x) => x.desc);
    expect(q('PINGO')).toEqual(['Pingo Doce']);
    expect(q('shared')).toEqual(['Pingo Doce']);
    expect(q('12.5')).toEqual(['Pingo Doce']);
    expect(q('fuel')).toEqual(['Galp']);
  });

  it('filters by category', () => {
    expect(searchTransactions(txs, '2026-03-10', 'month', '', 'Groceries').map((x) => x.desc)).toEqual(['Padaria', 'Pingo Doce']);
  });
});

describe('account balances', () => {
  const acc = (id: string, kind: Account['kind'], openingBalance = 0, openingDate = '2026-01-01', more: Partial<Account> = {}): Account => ({
    id, name: id, kind, currency: 'EUR', openingBalance, openingDate, institution: '', archived: false, ...more,
  });
  const on = (acc: string, date: string, amount: number, type: Transaction['type'] = 'e', more: Partial<Transaction> = {}) =>
    tx(date, amount, { type, acc, cat: type === 'e' || type === 'i' ? 'Groceries' : '', ...more });

  it('is the opening balance plus everything on or after the opening date', () => {
    const main = acc('main', 'checking', 1000, '2026-03-01');
    const txs = [
      on('main', '2026-02-28', 999), // before the opening balance: already in it
      on('main', '2026-03-01', 2000, 'i'),
      on('main', '2026-03-02', 150),
      on('main', '2026-03-03', -20), // money back
      on('main', '2026-03-04', -5, 'a'),
      on('main', '2026-03-05', 70, 'e', { del: '2026-03-06T00:00:00Z' }),
    ];
    expect(accountBalance(main, txs)).toBe(2865);
  });

  it('moves money with transfers without changing the total (A: 2000, B: 3000, move 500)', () => {
    const accounts = [acc('a', 'checking', 2000), acc('b', 'savings', 3000)];
    const o = overview(accounts, [on('a', '2026-03-01', 500, 't', { to: 'b', toAmt: 500 })]);
    expect(o.balances.map((b) => b.balance)).toEqual([1500, 3500]);
    expect(o.netWorth).toBe(5000);
    expect([o.available, o.savings]).toEqual([1500, 3500]);
  });

  it('totals by kind, with credit cards as debt, and warns about negative non-credit balances', () => {
    const accounts = [
      acc('main', 'checking', 100),
      acc('meal', 'restricted', 0),
      acc('visa', 'credit', 0),
      acc('old', 'savings', 50, '2026-01-01', { archived: true }),
      acc('gone', 'savings', 999, '2026-01-01', { deletedAt: '2026-03-01T00:00:00Z' }),
    ];
    const txs = [
      on('meal', '2026-03-01', 160, 'i'),
      on('meal', '2026-03-02', 40),
      on('visa', '2026-03-03', 300),
      on('main', '2026-03-04', 250),
      on('main', '2026-03-28', 100, 't', { to: 'visa', toAmt: 100 }), // paying the card isn't spending
    ];
    const o = overview(accounts, txs);
    expect(o.balances.map((b) => [b.account.id, b.balance, b.warning])).toEqual([
      ['main', -250, true],
      ['meal', 120, false],
      ['visa', -200, false],
      ['old', 50, false],
    ]);
    expect(o).toMatchObject({ netWorth: -280, available: -250, restricted: 120, savings: 50, creditDebt: 200 });
    expect(o.has).toEqual({ checking: true, savings: true, restricted: true, credit: true });
    expect(summarize(txs, '2026-03-01', 'month', '2026-03-31', accounts).total).toBe(590);
  });

  it('blocks deleting the last open account or one with transfers', () => {
    const accounts = [acc('a', 'checking'), acc('b', 'savings')];
    expect(accountDeleteBlocker(accounts[0]!, [accounts[0]!], [])).toBe('last');
    expect(accountDeleteBlocker(accounts[1]!, accounts, [on('a', '2026-03-01', 5, 't', { to: 'b', toAmt: 5 })])).toBe('transfers');
    expect(accountDeleteBlocker(accounts[1]!, accounts, [on('b', '2026-03-01', 5)])).toBeNull();
  });

  it('leaves out transactions on deleted accounts', () => {
    const accounts = [acc('a', 'checking'), acc('b', 'checking', 0, '2026-01-01', { deletedAt: '2026-03-01T00:00:00Z' })];
    const txs = [on('a', '2026-03-01', 5), on('b', '2026-03-01', 7)];
    expect(visibleTransactions(txs, accounts).map((x) => x.amount)).toEqual([5]);
  });
});

describe('reimbursements', () => {
  const purchase = (id: string, date: string, amount: number) => ({ ...tx(date, amount, { reimb: 1 as const }), id });
  const back = (id: string, amount: number) => ({ ...tx('2026-03-20', -amount), id });

  it('a work trip paid with the meal card and paid back into the current account nets to zero spending', () => {
    const meal = purchase('p1', '2026-03-05', 20);
    const repaid = { ...back('r1', 20), acc: 'main' };
    const txs = [{ ...meal, acc: 'meal' }, repaid];
    expect(summarize(txs, '2026-03-01', 'month', '2026-03-31').total).toBe(0);
    expect(owedToYou(txs, [{ repayment: 'r1', purchase: 'p1', amount: 20 }])).toBe(0);
    expect(owedToYou(txs, [])).toBe(20);
  });

  it('one repayment can settle several purchases, partly', () => {
    const txs = [purchase('a', '2026-03-01', 100), purchase('b', '2026-03-02', 50), back('r', 120)];
    const links = [
      { repayment: 'r', purchase: 'a', amount: 100 },
      { repayment: 'r', purchase: 'b', amount: 20 },
    ];
    expect(outstandingPurchases(txs, links).map((o) => [o.purchase.id, o.remaining])).toEqual([['b', 30]]);
    expect(owedToYou(txs, links)).toBe(30);
    // While editing the repayment, its own shares are free to choose again.
    expect(outstandingPurchases(txs, links, 'r').map((o) => o.remaining)).toEqual([100, 50]);
  });

  it('ignores deleted repayments and splits money back oldest first', () => {
    const txs = [purchase('a', '2026-03-01', 10), { ...back('r', 10), del: '2026-03-21T00:00:00Z' }];
    expect(owedToYou(txs, [{ repayment: 'r', purchase: 'a', amount: 10 }])).toBe(10);
    expect(allocate(120, [100, 50])).toEqual([100, 20]);
    expect(allocate(30.3, [10.1, 10.1, 50])).toEqual([10.1, 10.1, 10.1]);
  });
});
