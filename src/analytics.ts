import { daysInMonth, inPeriod, MONTH_NAMES, pad, parseIsoDate, shiftRef, toIsoDate } from './dates';
import type { Budgets, Mode, Transaction } from './types';

// All functions are pure. `ref` is the selected date (YYYY-MM-DD) and `today` the
// current local date; together with `mode` they define the period being looked at.

export const sumAmounts = (txs: Transaction[]): number => txs.reduce((s, x) => s + x.amount, 0);

export const expensesOf = (txs: Transaction[]): Transaction[] => txs.filter((x) => x.type === 'e');
export const incomesOf = (txs: Transaction[]): Transaction[] => txs.filter((x) => x.type === 'i');

export const inPeriodOf = (txs: Transaction[], ref: string, mode: Mode): Transaction[] =>
  txs.filter((x) => inPeriod(x.date, ref, mode));

/** Sum per category, keyed in first-seen order. */
export function totalsByCategory(txs: Transaction[]): Record<string, number> {
  const by: Record<string, number> = {};
  txs.forEach((x) => (by[x.cat] = (by[x.cat] || 0) + x.amount));
  return by;
}

/** Number of units the period is averaged over: days in the month, 12 months, or 1 day. */
export function periodSpan(ref: string, mode: Mode): number {
  const [y, m] = parseIsoDate(ref);
  return mode === 'month' ? daysInMonth(y, m) : mode === 'year' ? 12 : 1;
}

/**
 * Projected total at the end of the current month or year, extrapolated linearly from
 * the spending so far. Null for day mode and for periods other than the current one.
 */
export function projectedTotal(total: number, ref: string, mode: Mode, today: string): number | null {
  const [y, m] = parseIsoDate(ref);
  const [ny, nm, nd] = parseIsoDate(today);
  if (mode === 'month' && y === ny && m === nm) return (total / nd) * periodSpan(ref, mode);
  if (mode === 'year' && y === ny) return (total / nm) * 12;
  return null;
}

export interface Change {
  /** Rounded percentage change. */
  percent: number;
  isIncrease: boolean;
  /** Whether to prefix a "+" (no decrease, even when the rounded value is 0). */
  showPlus: boolean;
}

/** Change from `previous` to `current`, or null when there is nothing to compare to. */
export function percentChange(current: number, previous: number): Change | null {
  if (!previous) return null;
  return {
    percent: Math.round(((current - previous) / previous) * 100),
    isIncrease: current > previous,
    showPlus: current >= previous,
  };
}

export interface PeriodSummary {
  /** Expenses in the period. */
  expenses: Transaction[];
  total: number;
  income: number;
  previousTotal: number;
  /** Category totals for the period, largest first. */
  categories: [string, number][];
  byCategory: Record<string, number>;
  previousByCategory: Record<string, number>;
  span: number;
  /** Average per day (month mode) or per month (year mode). */
  average: number;
  projected: number | null;
  net: number;
  /** Rounded percentage; null without income. */
  savingsRate: number | null;
  fixed: number;
  /** Rounded percentage of spending from recurring expenses. */
  fixedShare: number;
  variable: number;
}

export function summarize(txs: Transaction[], ref: string, mode: Mode, today: string): PeriodSummary {
  const expenses = inPeriodOf(expensesOf(txs), ref, mode);
  const total = sumAmounts(expenses);
  const income = sumAmounts(inPeriodOf(incomesOf(txs), ref, mode));
  const previous = inPeriodOf(expensesOf(txs), shiftRef(ref, -1, mode), mode);
  const byCategory = totalsByCategory(expenses);
  const fixed = sumAmounts(expenses.filter((x) => x.fixed));
  const span = periodSpan(ref, mode);
  return {
    expenses,
    total,
    income,
    previousTotal: sumAmounts(previous),
    categories: Object.entries(byCategory).sort((a, b) => b[1] - a[1]),
    byCategory,
    previousByCategory: totalsByCategory(previous),
    span,
    average: total / span,
    projected: projectedTotal(total, ref, mode, today),
    net: income - total,
    savingsRate: income ? Math.round(((income - total) / income) * 100) : null,
    fixed,
    fixedShare: total ? Math.round((fixed / total) * 100) : 0,
    variable: total - fixed,
  };
}

export interface TrendBar {
  /** Axis label; empty for unlabelled bars. */
  label: string;
  byCategory: Record<string, number>;
  total: number;
}

/**
 * Spending bars stacked by category: the 7 days up to `ref` (day mode), each day of the
 * month, or each month of the year.
 */
export function trendBars(expenses: Transaction[], ref: string, mode: Mode): TrendBar[] {
  const [y, m, d] = parseIsoDate(ref);
  const buckets: [string, (x: Transaction) => boolean][] = [];
  if (mode === 'day') {
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(y, m - 1, d - i, 12);
      buckets.push([String(dt.getDate()), (x) => x.date === toIsoDate(dt)]);
    }
  } else if (mode === 'month') {
    for (let i = 1; i <= daysInMonth(y, m); i++) {
      const k = `${y}-${pad(m)}-${pad(i)}`;
      buckets.push([i % 5 === 1 ? String(i) : '', (x) => x.date === k]);
    }
  } else {
    for (let i = 1; i <= 12; i++) {
      const k = `${y}-${pad(i)}`;
      buckets.push([MONTH_NAMES[i - 1]![0]!, (x) => x.date.slice(0, 7) === k]);
    }
  }
  return buckets.map(([label, match]) => {
    const byCategory = totalsByCategory(expenses.filter(match));
    return { label, byCategory, total: Object.values(byCategory).reduce((a, b) => a + b, 0) };
  });
}

export interface HeatmapDay {
  date: string;
  total: number;
}

/** One entry per day of the month or year. Empty in day mode. */
export function heatmapDays(periodExpenses: Transaction[], ref: string, mode: Mode): HeatmapDay[] {
  if (mode === 'day') return [];
  const [y, m] = parseIsoDate(ref);
  const n = mode === 'month' ? daysInMonth(y, m) : y % 4 ? 365 : 366;
  const days: HeatmapDay[] = [];
  for (let i = 0; i < n; i++) {
    const date = toIsoDate(mode === 'month' ? new Date(y, m - 1, i + 1, 12) : new Date(y, 0, i + 1, 12));
    days.push({ date, total: sumAmounts(periodExpenses.filter((x) => x.date === date)) });
  }
  return days;
}

export interface Merchant {
  name: string;
  total: number;
  count: number;
}

/** Descriptions with the highest spend, grouped case-insensitively. */
export function topMerchants(periodExpenses: Transaction[], limit = 5): Merchant[] {
  const mm: Record<string, Merchant> = {};
  periodExpenses.forEach((x) => {
    const k = x.desc.toLowerCase();
    mm[k] = mm[k] || { name: x.desc, total: 0, count: 0 };
    mm[k].total += x.amount;
    mm[k].count++;
  });
  return Object.values(mm)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export interface QuickPick {
  desc: string;
  cat: string;
  /** Amount of the most recently added expense with this description. */
  amount: number;
}

/** Most frequent expense descriptions, for one-tap entry. */
export function frequentExpenses(expenses: Transaction[], limit = 6): QuickPick[] {
  const f: Record<string, QuickPick & { n: number }> = {};
  expenses.forEach((x) => {
    const k = x.desc.toLowerCase();
    f[k] = f[k] || { n: 0, desc: x.desc, cat: x.cat, amount: x.amount };
    f[k].n++;
    f[k].amount = x.amount;
  });
  return Object.values(f)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map(({ desc, cat, amount }) => ({ desc, cat, amount }));
}

/**
 * Transactions in the period matching the category filter and the search text
 * (description, tags, amount or category), newest first.
 */
export function searchTransactions(txs: Transaction[], ref: string, mode: Mode, query: string, category: string): Transaction[] {
  const q = query.toLowerCase();
  return txs
    .filter(
      (x) =>
        inPeriod(x.date, ref, mode) &&
        (!category || x.cat === category) &&
        (!q || (x.desc + ' ' + (x.tags || '') + ' ' + x.amount + ' ' + x.cat).toLowerCase().includes(q)),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

export type BudgetStatus = 'none' | 'ok' | 'near' | 'over';

export interface CategoryRow {
  cat: string;
  spent: number;
  /** Budget for the period (monthly budget x 12 in year mode); 0 when none. */
  budget: number;
  /** Bar fill, 0-1: share of the budget, or relative to the largest category without one. */
  fill: number;
  status: BudgetStatus;
  /** Whether to show a comparison with the previous period. */
  showChange: boolean;
  change: Change | null;
}

/**
 * Rows for every category with spending in the period, plus (outside day mode) every
 * category with a budget, largest spend first.
 */
export function categoryRows(summary: PeriodSummary, budgets: Budgets, mode: Mode): CategoryRow[] {
  const { byCategory: by, previousByCategory: pby, categories } = summary;
  const mult = mode === 'year' ? 12 : 1;
  const names = [...new Set([...categories.map((e) => e[0]), ...(mode === 'day' ? [] : Object.keys(budgets))])];
  return names
    .sort((a, b) => (by[b] || 0) - (by[a] || 0))
    .map((cat) => {
      const spent = by[cat] || 0;
      const budget = mode === 'day' ? 0 : (budgets[cat] || 0) * mult;
      const r = budget ? spent / budget : spent / (categories[0] ? categories[0][1] : 1);
      return {
        cat,
        spent,
        budget,
        fill: Math.min(r, 1),
        status: budget ? (r > 1 ? 'over' : r > 0.8 ? 'near' : 'ok') : 'none',
        showChange: pby[cat] !== undefined || !!spent,
        change: percentChange(spent, pby[cat] || 0),
      };
    });
}
