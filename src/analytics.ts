import { daysInMonth, inPeriod, pad, parseIsoDate, shiftRef, toIsoDate } from './dates';
import { monthNames } from './i18n';
import type { Account, Budgets, Mode, Transaction, TransactionLink } from './types';

// All functions are pure. `ref` is the selected date (YYYY-MM-DD) and `today` the
// current local date; together with `mode` they define the period being looked at.

export const sumAmounts = (txs: Transaction[]): number => txs.reduce((s, x) => s + x.amount, 0);

/** Transactions that aren't soft-deleted. */
export const liveOf = (txs: Transaction[]): Transaction[] => txs.filter((x) => !x.del);
/** Spending, including money back (negative amounts). */
export const expensesOf = (txs: Transaction[]): Transaction[] => txs.filter((x) => x.type === 'e' && !x.del);
export const incomesOf = (txs: Transaction[]): Transaction[] => txs.filter((x) => x.type === 'i' && !x.del);

/**
 * Net amount moved into savings accounts by transfers: what arrived in them minus what
 * left them. Transfers between two savings accounts cancel out.
 */
export function movedToSavings(txs: Transaction[], accounts: Account[]): number {
  const savings = new Set(accounts.filter((a) => a.kind === 'savings').map((a) => a.id));
  let n = 0;
  for (const x of txs) {
    if (x.type !== 't' || x.del) continue;
    if (savings.has(x.to!)) n += x.toAmt ?? x.amount;
    if (savings.has(x.acc!)) n -= x.amount;
  }
  return n;
}

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
  /** Net amount transferred into savings accounts in the period (negative: taken out). */
  saved: number;
  previousTotal: number;
  /** Category totals for the period, largest first. */
  categories: [string, number][];
  byCategory: Record<string, number>;
  previousByCategory: Record<string, number>;
  span: number;
  /** Average per day (month mode) or per month (year mode). */
  average: number;
  projected: number | null;
  /** Income minus spending. */
  net: number;
  /** Rounded percentage of income not spent (moved to savings or not); null without income. */
  savingsRate: number | null;
  fixed: number;
  /** Rounded percentage of spending from recurring expenses. */
  fixedShare: number;
  variable: number;
}

export function summarize(txs: Transaction[], ref: string, mode: Mode, today: string, accounts: Account[] = []): PeriodSummary {
  const expenses = inPeriodOf(expensesOf(txs), ref, mode);
  const total = sumAmounts(expenses);
  const income = sumAmounts(inPeriodOf(incomesOf(txs), ref, mode));
  const saved = movedToSavings(inPeriodOf(txs, ref, mode), accounts);
  const previous = inPeriodOf(expensesOf(txs), shiftRef(ref, -1, mode), mode);
  const byCategory = totalsByCategory(expenses);
  const fixed = sumAmounts(expenses.filter((x) => x.fixed));
  const span = periodSpan(ref, mode);
  return {
    expenses,
    total,
    income,
    saved,
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

/**
 * An account's balance: its opening balance plus every transaction on or after its
 * opening date (earlier ones are already in the opening balance). Income and money
 * arriving by transfer add; spending and money leaving by transfer subtract; money back
 * (a negative expense) adds; adjustments add their signed amount.
 */
export function accountBalance(account: Account, txs: Transaction[]): number {
  let n = account.openingBalance;
  for (const x of txs) {
    if (x.del || x.date < account.openingDate) continue;
    if (x.acc === account.id) n += x.type === 'i' || x.type === 'a' ? x.amount : -x.amount;
    if (x.type === 't' && x.to === account.id) n += x.toAmt ?? x.amount;
  }
  return Math.round(n * 100) / 100;
}

export interface AccountBalance {
  account: Account;
  balance: number;
  /** Below zero on an account that isn't a credit card: probably a missing entry. */
  warning: boolean;
}

export interface Overview {
  /** Every account that isn't soft-deleted, archived ones included, in order. */
  balances: AccountBalance[];
  /** Sum of all balances; credit cards count as (negative) debt. */
  netWorth: number;
  /** Current accounts: money free to spend. */
  available: number;
  /** Meal cards, benefits wallets: money only for some purchases. */
  restricted: number;
  savings: number;
  /** What is owed on credit cards, as a positive number. */
  creditDebt: number;
  /** Which of those totals have any account, so empty ones can be hidden. */
  has: Record<Account['kind'], boolean>;
}

export function overview(accounts: Account[], txs: Transaction[]): Overview {
  const balances = accounts
    .filter((a) => !a.deletedAt)
    .map((account) => {
      const balance = accountBalance(account, txs);
      return { account, balance, warning: account.kind !== 'credit' && balance < 0 };
    });
  const sum = (kind: Account['kind']) => balances.filter((b) => b.account.kind === kind).reduce((s, b) => s + b.balance, 0);
  const round = (n: number) => Math.round(n * 100) / 100;
  const has = { checking: false, savings: false, restricted: false, credit: false };
  balances.forEach((b) => (has[b.account.kind] = true));
  return {
    balances,
    netWorth: round(balances.reduce((s, b) => s + b.balance, 0)),
    available: round(sum('checking')),
    restricted: round(sum('restricted')),
    savings: round(sum('savings')),
    creditDebt: round(-sum('credit')),
    has,
  };
}

/** Transactions that touch an account: on it, or transfers into it. */
export const onAccount = (txs: Transaction[], id: string): Transaction[] => txs.filter((x) => x.acc === id || x.to === id);

/** Leave out transactions on soft-deleted accounts (and soft-deleted transactions). */
export function visibleTransactions(txs: Transaction[], accounts: Account[]): Transaction[] {
  const deleted = new Set(accounts.filter((a) => a.deletedAt).map((a) => a.id));
  return txs.filter((x) => !x.del && !deleted.has(x.acc!) && !(x.to && deleted.has(x.to)));
}

/**
 * Why an account can't be soft-deleted, or null if it can: it is the last open account,
 * or transfers link it to other accounts (deleting it would change their balances).
 */
export function accountDeleteBlocker(account: Account, accounts: Account[], txs: Transaction[]): 'last' | 'transfers' | null {
  if (!accounts.some((a) => a.id !== account.id && !a.deletedAt && !a.archived)) return 'last';
  if (txs.some((x) => !x.del && x.type === 't' && (x.acc === account.id || x.to === account.id))) return 'transfers';
  return null;
}

export interface Outstanding {
  purchase: Transaction;
  /** Still to be paid back. */
  remaining: number;
}

/**
 * Reimbursable purchases not yet fully paid back, oldest first. Links of `ignoring` (money
 * back being edited) don't count, so its shares can be chosen again.
 */
export function outstandingPurchases(txs: Transaction[], links: TransactionLink[], ignoring?: string): Outstanding[] {
  const live = new Set(txs.filter((x) => !x.del).map((x) => x.id));
  const settled: Record<string, number> = {};
  for (const l of links) if (l.repayment !== ignoring && live.has(l.repayment)) settled[l.purchase] = (settled[l.purchase] ?? 0) + l.amount;
  return txs
    .filter((x) => x.reimb && !x.del && x.type === 'e' && x.amount > 0)
    .map((purchase) => ({ purchase, remaining: Math.round((purchase.amount - (settled[purchase.id] ?? 0)) * 100) / 100 }))
    .filter((o) => o.remaining > 0)
    .sort((a, b) => a.purchase.date.localeCompare(b.purchase.date));
}

/** What others still owe you for reimbursable purchases. */
export const owedToYou = (txs: Transaction[], links: TransactionLink[]): number =>
  Math.round(outstandingPurchases(txs, links).reduce((s, o) => s + o.remaining, 0) * 100) / 100;

/**
 * Share `amount` of money back among purchases in order, each up to what it still owes:
 * the default split, which the user can change.
 */
export function allocate(amount: number, remaining: number[]): number[] {
  let left = Math.round(amount * 100);
  return remaining.map((r) => {
    const share = Math.min(left, Math.round(r * 100));
    left -= share;
    return share / 100;
  });
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
      buckets.push([monthNames()[i - 1]![0]!.toUpperCase(), (x) => x.date.slice(0, 7) === k]);
    }
  }
  return buckets.map(([label, match]) => {
    // Money back can make a category negative for a bar; bars only show spending.
    const byCategory = Object.fromEntries(Object.entries(totalsByCategory(expenses.filter(match))).filter(([, v]) => v > 0));
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
    days.push({ date, total: Math.max(0, sumAmounts(periodExpenses.filter((x) => x.date === date))) });
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
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

export interface QuickPick {
  desc: string;
  cat: string;
  sub?: string;
  /** Amount of the most recently added expense with this description. */
  amount: number;
}

/** Most frequent expense descriptions, for one-tap entry. */
export function frequentExpenses(expenses: Transaction[], limit = 6): QuickPick[] {
  const f: Record<string, QuickPick & { n: number }> = {};
  expenses.filter((x) => x.amount > 0).forEach((x) => {
    const k = x.desc.toLowerCase();
    f[k] = f[k] || { n: 0, desc: x.desc, cat: x.cat, sub: x.sub, amount: x.amount };
    f[k].n++;
    f[k].amount = x.amount;
  });
  return Object.values(f)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map(({ desc, cat, sub, amount }) => ({ desc, cat, ...(sub ? { sub } : {}), amount }));
}

/**
 * Transactions in the period matching the category filter and the search text
 * (description, tags, amount or category), newest first. `txs` must be in the order
 * they were added; on the same date the one added last comes first.
 */
export function searchTransactions(txs: Transaction[], ref: string, mode: Mode, query: string, category: string): Transaction[] {
  const q = query.toLowerCase();
  return txs
    .map((x, i) => [x, i] as const)
    .filter(
      ([x]) =>
        inPeriod(x.date, ref, mode) &&
        (!category || x.cat === category) &&
        (!q || (x.desc + ' ' + (x.tags || '') + ' ' + x.amount + ' ' + x.cat + ' ' + (x.sub || '')).toLowerCase().includes(q)),
    )
    .sort(([a, i], [b, j]) => b.date.localeCompare(a.date) || j - i)
    .map(([x]) => x);
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
