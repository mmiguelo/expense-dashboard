import type { CategoryRow, Change, HeatmapDay, Merchant, PeriodSummary, QuickPick, TrendBar } from '../analytics';
import { categoryColor, expenseCategoryNames, INCOME_CATEGORY } from '../categories';
import { formatDmy, parseIsoDate } from '../dates';
import { escapeHtml as esc, formatEur as eur } from '../format';
import { monthNames, t, tn } from '../i18n';
import type { Budgets, Categories, KeywordRule, Mode, RecurringExpense, Subcategories, Transaction } from '../types';

// Pure HTML builders. Dashboard markup is kept identical to the original single-file app.

export const escape = esc;

export function periodLabel(ref: string, mode: Mode): string {
  const [y, m, d] = parseIsoDate(ref);
  const month = monthNames()[m - 1];
  return mode === 'day' ? `${d} ${month} ${y}` : mode === 'month' ? `${month} ${y}` : String(y);
}

export const trendTitle = (mode: Mode): string => t(`trend.${mode}`);

/** Expense categories; with `withIncome`, 'Rendimentos' last. */
export const categoryOptions = (cats: Categories, withIncome = false, withAll = false): string =>
  (withAll ? `<option value="">${esc(t('filter.allCategories'))}</option>` : '') +
  expenseCategoryNames(cats)
    .map((c) => `<option>${esc(c)}</option>`)
    .join('') +
  (withIncome ? `<option>${INCOME_CATEGORY}</option>` : '');

/** A category's subcategories, after a "none" option. */
export const subcategoryOptions = (names: string[] = []): string =>
  '<option value="">—</option>' + names.map((n) => `<option>${esc(n)}</option>`).join('');

/** "Category › Subcategory", or just the category. */
export const categoryLabel = (cat: string, sub?: string): string => esc(cat) + (sub ? ` › ${esc(sub)}` : '');

const change = (c: Change | null): string =>
  c ? `<span class="${c.isIncrease ? 'up' : 'dn'}">${c.showPlus ? '+' : ''}${c.percent}%</span>` : `<span class="mute">${t('change.new')}</span>`;

export function summaryHtml(s: PeriodSummary, mode: Mode, vsPrevious: Change | null): string {
  const previous = s.previousTotal
    ? t(`sum.vsPrevious.${mode}`, { change: change(vsPrevious), amount: eur(s.previousTotal) })
    : t(`sum.noPrevious.${mode}`);
  return `<div class="mute">${t(`sum.spent.${mode}`)}</div><div class="total">${eur(s.total)}</div><div class="mute">${previous}</div>
 <div class="stats"><div><b>${s.expenses.length}</b><small>${t('sum.expenses')}</small></div>${mode !== 'day' ? `<div><b>${eur(s.average)}</b><small>${t(mode === 'year' ? 'sum.avgPerMonth' : 'sum.avgPerDay')}</small></div>` : ''}
 ${s.projected !== null ? `<div><b>${eur(s.projected)}</b><small>${t(mode === 'year' ? 'sum.projectedYear' : 'sum.projectedMonth')}</small></div>` : ''}
 <div><b>${eur(s.income)}</b><small>${t('sum.income')}</small></div><div><b class="${s.net < 0 ? 'up' : ''}">${eur(s.net)}</b><small>${t('sum.net')}</small></div>${s.savingsRate !== null ? `<div><b>${s.savingsRate}%</b><small>${t('sum.savingsRate')}</small></div>` : ''}
 <div><b>${s.fixedShare}%</b><small>${t('sum.fixed', { amount: eur(s.fixed) })}</small></div><div><b>${eur(s.variable)}</b><small>${t('sum.variable')}</small></div></div>`;
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
  if (!ents.length) return `<div class="mute">${t('donut.empty')}</div>`;
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
  return `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 42 42" width="150" height="150" role="img" aria-label="${esc(t('dash.categoryShare'))}"><circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--line)" stroke-width="6"/>${arcs}</svg><div>${legend}</div></div>`;
}

const BUDGET_COLORS = { over: 'var(--bad)', near: 'var(--warn)' } as const;

export function categoryRowsHtml(rows: CategoryRow[], cats: Categories): string {
  if (!rows.length) return `<div class="mute">${t('catRows.empty')}</div>`;
  return rows
    .map((r) => {
      const color = r.status === 'over' || r.status === 'near' ? BUDGET_COLORS[r.status] : categoryColor(r.cat, cats);
      return `<div style="padding:6px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>${esc(r.cat)}</span><span><b>${eur(r.spent)}</b>${r.budget ? ` <small>${t('catRows.ofBudget', { amount: eur(r.budget) })}</small>` : ''} <small>${r.showChange ? change(r.change) : ''}</small></span></div><div class="bar"><i style="width:${r.fill * 100}%;background:${color}"></i></div></div>`;
    })
    .join('');
}

export function heatmapHtml(days: HeatmapDay[]): string {
  const max = Math.max(...days.map((d) => d.total), 1);
  return days
    .map((d) => `<i title="${formatDmy(d.date)}: ${eur(d.total)}" style="opacity:${d.total ? 0.2 + (d.total / max) * 0.8 : 0.08}"></i>`)
    .join('');
}

export const topMerchantsHtml = (merchants: Merchant[]): string =>
  merchants
    .map((z) => `<div class="row" style="grid-template-columns:1fr auto"><div>${esc(z.name)} <small>${z.count}×</small></div><b>${eur(z.total)}</b></div>`)
    .join('') || `<div class="mute">${t('top.empty')}</div>`;

export function transactionListHtml(txs: Transaction[], cats: Categories): string {
  if (!txs.length) return `<div class="mute">${t('list.empty')}</div>`;
  return txs
    .map(
      (x) =>
        `<div class="row"><span class="dot" style="background:${categoryColor(x.cat, cats)}"></span><div>${esc(x.desc)}<div class="mute">${formatDmy(x.date)}, ${categoryLabel(x.cat, x.sub)}${x.tags ? ', ' + esc(x.tags) : ''}</div></div><div><b>${x.type === 'i' ? '+' : ''}${eur(x.amount)}</b> <button class="x" data-edit="${x.id}" aria-label="${esc(t('common.edit'))}">✎</button><button class="x" data-del="${x.id}" aria-label="${esc(t('common.delete'))}">✕</button></div></div>`,
    )
    .join('');
}

export const quickPicksHtml = (picks: QuickPick[]): string =>
  picks.map((c) => `<button type="button" data-chip='${esc(JSON.stringify(c))}'>${esc(c.desc)}</button>`).join('');

export const budgetInputsHtml = (cats: Categories, budgets: Budgets): string =>
  expenseCategoryNames(cats)
    .map((c) => `<span>${esc(c)}</span><input inputmode="decimal" data-b="${esc(c)}" value="${budgets[c] || ''}" placeholder="${esc(t('budget.placeholder'))}">`)
    .join('');

export const recurringListHtml = (rules: RecurringExpense[], cats: Categories): string =>
  rules.length
    ? rules
        .map(
          (r) =>
            `<div class="row"><span class="dot" style="background:${categoryColor(r.cat, cats)}"></span><div>${esc(r.desc)} <span class="mute">${categoryLabel(r.cat, r.sub)}, ${t('rec.day', { day: r.day })}</span></div><div><b>${eur(r.amount)}</b> <button class="x" data-rdel="${r.id}" aria-label="${esc(t('common.remove'))}">✕</button></div></div>`,
        )
        .join('')
    : `<div class="mute">${t('rec.empty')}</div>`;

// ---- Settings ----

/** `open`: categories whose subcategory list is shown. */
export const categoryEditorHtml = (cats: Categories, usage: Record<string, number>, subs: Subcategories = {}, open: Set<string> = new Set()): string =>
  Object.entries(cats)
    .map(([name, color]) => {
      const n = usage[name] || 0;
      const e = esc(name);
      const fixed = name === INCOME_CATEGORY;
      const names = subs[name] || [];
      const colour = `<input type="color" value="${esc(color)}" data-cat-color="${e}" aria-label="${esc(t('cat.colourOf', { name }))}">`;
      const row = fixed
        ? `<div class="erow">${colour}<input value="${e}" readonly aria-label="${esc(t('common.name'))}"><span class="mute">${t('cat.income')}</span><span></span></div>`
        : `<div class="erow">${colour}<input value="${e}" data-cat-name="${e}" maxlength="100" aria-label="${esc(t('common.name'))}"><button type="button" data-cat-rename="${e}">${t('cat.rename')}</button><button type="button" class="x" data-cat-delete="${e}" aria-label="${esc(t('cat.deleteNamed', { name }))}" title="${esc(tn('cat.txCount', n))}">✕</button></div>`;
      const chips = names
        .map(
          (s) =>
            `<span class="subchip">${esc(s)}<button type="button" class="x" data-sub-delete="${esc(s)}" data-sub-cat="${e}" aria-label="${esc(t('cat.deleteNamed', { name: s }))}">✕</button></span>`,
        )
        .join('');
      return `<div class="catblock" data-cat-row="${e}">${row}<details class="subs" data-subs="${e}"${open.has(name) ? ' open' : ''}><summary>${tn('sub.count', names.length)}</summary><div class="subchips">${chips}</div><div class="subadd"><input data-sub-new="${e}" placeholder="${esc(t('sub.new'))}" maxlength="100" aria-label="${esc(t('sub.newOf', { name }))}"><button type="button" data-sub-add="${e}">${t('common.add')}</button></div></details></div>`;
    })
    .join('') || `<div class="mute">${t('cat.empty')}</div>`;

export function keywordRulesHtml(rules: KeywordRule[], cats: Categories, filter: string): string {
  const f = filter.toLowerCase().trim();
  const shown = rules.filter((r) => !f || r.keyword.includes(f) || r.category.toLowerCase().includes(f));
  if (!shown.length) return `<div class="mute">${t(rules.length ? 'rules.noMatch' : 'rules.empty')}</div>`;
  return shown
    .map((r) => {
      const options = [...new Set([...Object.keys(cats), r.category])]
        .map((c) => `<option${c === r.category ? ' selected' : ''}>${esc(c)}</option>`)
        .join('');
      return `<div class="krow"><code>${esc(r.keyword.replace(/ /g, '␣'))}</code><select data-rule-cat="${r.id}" aria-label="${esc(t('rules.categoryFor', { keyword: r.keyword }))}">${options}</select><button type="button" class="x" data-rule-delete="${r.id}" aria-label="${esc(t('rules.deleteNamed', { keyword: r.keyword }))}">✕</button></div>`;
    })
    .join('');
}
