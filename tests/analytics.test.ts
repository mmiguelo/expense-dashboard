import { describe, expect, it } from 'vitest';
import {
  categoryRows,
  frequentExpenses,
  heatmapDays,
  percentChange,
  periodSpan,
  projectedTotal,
  searchTransactions,
  summarize,
  topMerchants,
  totalsByCategory,
  trendBars,
} from '../src/analytics';
import type { Transaction } from '../src/types';

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
