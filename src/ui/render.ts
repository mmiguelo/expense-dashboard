import type { CategoryRow, Change, HeatmapDay, Merchant, PeriodSummary, QuickPick, TrendBar } from '../analytics';
import { categoryColor, INCOME_CATEGORY } from '../categories';
import { formatDmy, MONTH_NAMES, parseIsoDate } from '../dates';
import { escapeHtml as esc, formatEur as eur } from '../format';
import type { Budgets, Categories, Mode, RecurringExpense, Transaction } from '../types';

// Pure HTML builders. Markup is kept identical to the original single-file app.

export function periodLabel(ref: string, mode: Mode): string {
  const [y, m, d] = parseIsoDate(ref);
  return mode === 'day' ? `${d} ${MONTH_NAMES[m - 1]} ${y}` : mode === 'month' ? `${MONTH_NAMES[m - 1]} ${y}` : String(y);
}

export const trendTitle = (mode: Mode): string =>
  mode === 'day' ? 'Last 7 days' : mode === 'month' ? 'Daily spending by category' : 'Monthly spending by category';

export const categoryOptions = (cats: Categories, withIncome = false, withAll = false): string =>
  (withAll ? '<option value="">All categories</option>' : '') +
  Object.keys(cats)
    .map((c) => `<option>${esc(c)}</option>`)
    .join('') +
  (withIncome ? `<option>${INCOME_CATEGORY}</option>` : '');

const change = (c: Change | null): string =>
  c ? `<span class="${c.isIncrease ? 'up' : 'dn'}">${c.showPlus ? '+' : ''}${c.percent}%</span>` : '<span class="mute">new</span>';

export function summaryHtml(s: PeriodSummary, mode: Mode, vsPrevious: Change | null): string {
  return `<div class="mute">Spent this ${mode}</div><div class="total">${eur(s.total)}</div><div class="mute">${s.previousTotal ? `${change(vsPrevious)} vs previous ${mode} (${eur(s.previousTotal)})` : `No data for previous ${mode}`}</div>
 <div class="stats"><div><b>${s.expenses.length}</b><small>expenses</small></div>${mode !== 'day' ? `<div><b>${eur(s.average)}</b><small>average per ${mode === 'year' ? 'month' : 'day'}</small></div>` : ''}
 ${s.projected !== null ? `<div><b>${eur(s.projected)}</b><small>projected ${mode === 'year' ? 'year' : 'month'} end</small></div>` : ''}
 <div><b>${eur(s.income)}</b><small>income</small></div><div><b class="${s.net < 0 ? 'up' : ''}">${eur(s.net)}</b><small>net balance</small></div>${s.savingsRate !== null ? `<div><b>${s.savingsRate}%</b><small>savings rate</small></div>` : ''}
 <div><b>${s.fixedShare}%</b><small>fixed (recurring) · ${eur(s.fixed)}</small></div><div><b>${eur(s.variable)}</b><small>variable</small></div></div>`;
}

export function trendHtml(bars: TrendBar[], cats: Categories): string {
  const max = Math.max(...bars.map((b) => b.total), 1);
  return bars
    .map(
      ({ label, byCategory, total }) =>
        `<div title="${eur(total)}"><div class="st" style="height:${(total / max) * 82}%">${Object.entries(byCategory)
          .map(([c, v]) => `<i style="height:${(v / total) * 100}%;background:${categoryColor(c, cats)}"></i>`)
          .join('')}</div><span>${label || '&nbsp;'}</span></div>`,
    )
    .join('');
}

export function donutHtml(s: PeriodSummary, cats: Categories): string {
  const { categories: ents, total } = s;
  if (!ents.length) return '<div class="mute">No expenses in this period.</div>';
  let off = 0;
  const arcs = ents
    .map(([c, v]) => {
      const p = (v / total) * 100;
      const arc = `<circle cx="21" cy="21" r="15.9" fill="none" stroke="${categoryColor(c, cats)}" stroke-width="6" stroke-dasharray="${p} ${100 - p}" stroke-dashoffset="${25 - off}"/>`;
      off += p;
      return arc;
    })
    .join('');
  const legend = ents
    .slice(0, 6)
    .map(([c, v]) => `<div><span class="dot" style="display:inline-block;background:${categoryColor(c, cats)}"></span> ${esc(c)} <b>${Math.round((v / total) * 100)}%</b></div>`)
    .join('');
  return `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 42 42" width="150" height="150" role="img" aria-label="Category share"><circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--line)" stroke-width="6"/>${arcs}</svg><div>${legend}</div></div>`;
}

const BUDGET_COLORS = { over: 'var(--bad)', near: 'var(--warn)' } as const;

export function categoryRowsHtml(rows: CategoryRow[], cats: Categories): string {
  if (!rows.length) return '<div class="mute">Add expenses, or set budgets in Settings.</div>';
  return rows
    .map((r) => {
      const color = r.status === 'over' || r.status === 'near' ? BUDGET_COLORS[r.status] : categoryColor(r.cat, cats);
      return `<div style="padding:6px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>${esc(r.cat)}</span><span><b>${eur(r.spent)}</b>${r.budget ? ` <small>of ${eur(r.budget)}</small>` : ''} <small>${r.showChange ? change(r.change) : ''}</small></span></div><div class="bar"><i style="width:${r.fill * 100}%;background:${color}"></i></div></div>`;
    })
    .join('');
}

export function heatmapHtml(days: HeatmapDay[]): string {
  const max = Math.max(...days.map((d) => d.total), 1);
  return days
    .map((d) => `<i title="${d.date}: ${eur(d.total)}" style="opacity:${d.total ? 0.2 + (d.total / max) * 0.8 : 0.08}"></i>`)
    .join('');
}

export const topMerchantsHtml = (merchants: Merchant[]): string =>
  merchants
    .map((z) => `<div class="row" style="grid-template-columns:1fr auto"><div>${esc(z.name)} <small>${z.count}×</small></div><b>${eur(z.total)}</b></div>`)
    .join('') || '<div class="mute">No data yet.</div>';

export function transactionListHtml(txs: Transaction[], cats: Categories): string {
  if (!txs.length) return '<div class="mute">Nothing here yet. Add a transaction above.</div>';
  return txs
    .map(
      (x) =>
        `<div class="row"><span class="dot" style="background:${categoryColor(x.cat, cats)}"></span><div>${esc(x.desc)}<div class="mute">${formatDmy(x.date)}, ${esc(x.cat)}${x.tags ? ', ' + esc(x.tags) : ''}</div></div><div><b>${x.type === 'i' ? '+' : ''}${eur(x.amount)}</b> <button class="x" data-edit="${x.id}" aria-label="Edit">✎</button><button class="x" data-del="${x.id}" aria-label="Delete">✕</button></div></div>`,
    )
    .join('');
}

export const quickPicksHtml = (picks: QuickPick[]): string =>
  picks.map((c) => `<button type="button" data-chip='${esc(JSON.stringify(c))}'>${esc(c.desc)}</button>`).join('');

export const budgetInputsHtml = (cats: Categories, budgets: Budgets): string =>
  Object.keys(cats)
    .map((c) => `<span>${esc(c)}</span><input inputmode="decimal" data-b="${esc(c)}" value="${budgets[c] || ''}" placeholder="€ / month">`)
    .join('');

export const recurringListHtml = (rules: RecurringExpense[], cats: Categories): string =>
  rules.length
    ? rules
        .map(
          (r) =>
            `<div class="row"><span class="dot" style="background:${categoryColor(r.cat, cats)}"></span><div>${esc(r.desc)} <span class="mute">${r.cat}, day ${r.day}</span></div><div><b>${eur(r.amount)}</b> <button class="x" data-rdel="${r.id}" aria-label="Remove">✕</button></div></div>`,
        )
        .join('')
    : '<div class="mute">No recurring expenses yet. Add your mortgage, insurance or gym once.</div>';
