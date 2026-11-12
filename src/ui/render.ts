import type { AccountBalance, CategoryRow, Change, HeatmapDay, Merchant, Overview, PeriodSummary, QuickPick, TrendBar } from '../analytics';
import { categoryColor, categoryNamesOfKind, expenseCategoryNames } from '../categories';
import { formatDmy, parseIsoDate } from '../dates';
import { amountToInput, CURRENCIES, currencySymbol, escapeHtml as esc, formatEur as eur } from '../format';
import { getLang, monthNames, t, tn } from '../i18n';
import type { Account, Budgets, Categories, CategoryKind, CategoryKinds, KeywordRule, Mode, RecurringExpense, Subcategories, Transaction } from '../types';
import type { Outstanding } from '../analytics';

// Pure HTML builders. Dashboard markup is kept identical to the original single-file app.

export const escape = esc;

export function periodLabel(ref: string, mode: Mode): string {
  const [y, m, d] = parseIsoDate(ref);
  const month = monthNames()[m - 1];
  return mode === 'day' ? `${d} ${month} ${y}` : mode === 'month' ? `${month} ${y}` : String(y);
}

export const trendTitle = (mode: Mode): string => t(`trend.${mode}`);

/** Expense categories; with `withIncome`, income categories after them. */
export const categoryOptions = (cats: Categories, withIncome = false, withAll = false, kinds: CategoryKinds = {}): string =>
  (withAll ? `<option value="">${esc(t('filter.allCategories'))}</option>` : '') +
  [...expenseCategoryNames(cats, kinds), ...(withIncome ? categoryNamesOfKind(cats, 'income', kinds) : [])]
    .map((c) => `<option>${esc(c)}</option>`)
    .join('');

/** The categories of one kind, for the transaction form. */
export const categoryOptionsOfKind = (cats: Categories, kind: CategoryKind, kinds: CategoryKinds): string =>
  categoryNamesOfKind(cats, kind, kinds)
    .map((c) => `<option>${esc(c)}</option>`)
    .join('');

/** Accounts to pick from, by id. */
export const accountOptions = (accounts: Account[]): string =>
  accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');

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
 <div class="stats"><div><b>${s.expenses.filter((x) => x.amount > 0).length}</b><small>${t('sum.expenses')}</small></div>${mode !== 'day' ? `<div><b>${eur(s.average)}</b><small>${t(mode === 'year' ? 'sum.avgPerMonth' : 'sum.avgPerDay')}</small></div>` : ''}
 ${s.projected !== null ? `<div><b>${eur(s.projected)}</b><small>${t(mode === 'year' ? 'sum.projectedYear' : 'sum.projectedMonth')}</small></div>` : ''}
 <div><b>${eur(s.income)}</b><small>${t('sum.income')}</small></div>${s.saved ? `<div><b>${eur(s.saved)}</b><small>${t('sum.saved')}</small></div>` : ''}<div><b class="${s.net < 0 ? 'up' : ''}">${eur(s.net)}</b><small>${t('sum.net')}</small></div>${s.savingsRate !== null ? `<div><b>${s.savingsRate}%</b><small>${t('sum.savingsRate')}</small></div>` : ''}
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
  // Shares of spending: a category that money back made negative has no slice.
  const ents = s.categories.filter(([, v]) => v > 0);
  const total = ents.reduce((a, [, v]) => a + v, 0);
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

const TRANSFER_COLOR = '#8a8478';

/**
 * Transactions, newest first. With more than one account, each says which account it
 * was on; transfers show "From → To" instead of a category.
 */
export function transactionListHtml(
  txs: Transaction[],
  cats: Categories,
  accounts: Account[] = [],
  /** Reimbursable purchases still owed, by id; one missing from here is paid back. */
  owed: Record<string, number> = {},
): string {
  if (!txs.length) return `<div class="mute">${t('list.empty')}</div>`;
  const name = (id?: string) => esc(accounts.find((a) => a.id === id)?.name ?? '');
  const several = accounts.filter((a) => !a.deletedAt).length > 1;
  return txs
    .map((x) => {
      const transfer = x.type === 't';
      const back = x.type === 'e' && x.amount < 0;
      const adjust = x.type === 'a';
      const reimb = x.reimb ? ` · ${x.id in owed ? t('list.owed', { amount: eur(owed[x.id]!) }) : t('list.settled')}` : '';
      const where = transfer
        ? `${name(x.acc)} → ${name(x.to)}`
        : adjust
          ? `${t('form.adjustment')} · ${name(x.acc)}`
          : categoryLabel(x.cat, x.sub) + (several ? ` · ${name(x.acc)}` : '') + reimb;
      const sign = x.type === 'i' ? '+' : transfer ? '→ ' : back ? '↩ +' : adjust ? (x.amount > 0 ? '⚖ +' : '⚖ −') : '';
      return `<div class="row"><span class="dot" style="background:${transfer || adjust ? TRANSFER_COLOR : categoryColor(x.cat, cats)}"></span><div>${esc(x.desc)}<div class="mute">${formatDmy(x.date)}, ${where}${x.tags ? ', ' + esc(x.tags) : ''}</div></div><div><b>${sign}${eur(Math.abs(x.amount))}</b> <button class="x" data-edit="${x.id}" aria-label="${esc(t('common.edit'))}">✎</button><button class="x" data-del="${x.id}" aria-label="${esc(t('common.delete'))}">✕</button></div></div>`;
    })
    .join('');
}

export const quickPicksHtml = (picks: QuickPick[]): string =>
  picks.map((c) => `<button type="button" data-chip='${esc(JSON.stringify(c))}'>${esc(c.desc)}</button>`).join('');

export const budgetInputsHtml = (cats: Categories, budgets: Budgets, kinds: CategoryKinds = {}): string =>
  expenseCategoryNames(cats, kinds)
    .map((c) => `<span>${esc(c)}</span><input inputmode="decimal" data-b="${esc(c)}" value="${budgets[c] || ''}" placeholder="${esc(t('budget.placeholder', { symbol: currencySymbol() }))}">`)
    .join('');

export function recurringListHtml(rules: RecurringExpense[], cats: Categories, accounts: Account[] = []): string {
  if (!rules.length) return `<div class="mute">${t('rec.empty')}</div>`;
  const name = (id?: string) => esc(accounts.find((a) => a.id === id)?.name ?? accounts.find((a) => !a.deletedAt)?.name ?? '');
  const several = accounts.filter((a) => !a.deletedAt).length > 1;
  return rules
    .map((r) => {
      const transfer = r.type === 't';
      const where = transfer ? `${name(r.acc)} → ${name(r.to)}` : categoryLabel(r.cat, r.sub) + (several ? ` · ${name(r.acc)}` : '');
      const sign = r.type === 'i' ? '+' : transfer ? '→ ' : '';
      return `<div class="row"><span class="dot" style="background:${transfer ? TRANSFER_COLOR : categoryColor(r.cat, cats)}"></span><div>${esc(r.desc)} <span class="mute">${where}, ${t('rec.day', { day: r.day })}</span></div><div><b>${sign}${eur(r.amount)}</b> <button class="x" data-rdel="${r.id}" aria-label="${esc(t('common.remove'))}">✕</button></div></div>`;
    })
    .join('');
}

/** Currencies, by code with their name in the page's language; `selected` first chosen. */
export function currencyOptions(selected = 'EUR'): string {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([getLang()], { type: 'currency' });
  } catch {
    // Older browsers: codes only.
  }
  const codes = CURRENCIES.includes(selected) ? CURRENCIES : [selected, ...CURRENCIES];
  return codes
    .map((c) => `<option value="${c}"${c === selected ? ' selected' : ''}>${c}${names ? ` — ${esc(names.of(c) ?? '')}` : ''}</option>`)
    .join('');
}

// ---- Accounts ----

export const ACCOUNT_KINDS: Account['kind'][] = ['checking', 'savings', 'restricted', 'credit'];

/** Account kinds, each with a plain-language hint of what belongs there. */
export const kindOptions = (): string =>
  ACCOUNT_KINDS.map((k) => `<option value="${k}">${esc(t(`kind.${k}`))} — ${esc(t(`kind.${k}.hint`))}</option>`).join('');

const accountMeta = (a: Account): string =>
  [t(`kind.${a.kind}`), a.institution, a.archived ? t('acc.archived') : ''].filter(Boolean).map(esc).join(' · ');

/**
 * "Where your money is": net worth, then a total per kind of account (only when there is
 * more than one kind), then one row per account (only when there is more than one).
 * Rows filter the dashboard to that account; `filter` is the one shown, if any.
 */
export function overviewHtml(o: Overview, filter: string | null, owed = 0): string {
  const kinds = Object.values(o.has).filter(Boolean).length;
  const tiles: [boolean, number, 'ov.available' | 'ov.restricted' | 'ov.savings' | 'ov.creditDebt'][] = [
    [o.has.checking, o.available, 'ov.available'],
    [o.has.restricted, o.restricted, 'ov.restricted'],
    [o.has.savings, o.savings, 'ov.savings'],
    [o.has.credit, o.creditDebt, 'ov.creditDebt'],
  ];
  const shown: [number, string][] = [
    ...(kinds > 1 ? tiles.filter(([on]) => on).map(([, n, key]) => [n, t(key)] as [number, string]) : []),
    ...(owed > 0 ? [[owed, t('ov.owed')] as [number, string]] : []),
  ];
  const stats = shown.length
    ? `<div class="stats">${shown.map(([n, label]) => `<div><b class="${n < 0 ? 'up' : ''}">${eur(n)}</b><small>${label}</small></div>`).join('')}</div>`
    : '';
  const rows = o.balances.length > 1
    ? `<div class="acclist">${o.balances.map((b) => accountRowHtml(b, b.account.id === filter)).join('')}</div>` +
      (filter
        ? `<div class="mute accnote">${t('ov.showing', { name: esc(o.balances.find((b) => b.account.id === filter)?.account.name ?? '') })} <button type="button" class="linkbtn" data-accf="">${t('ov.showAll')}</button></div>`
        : `<div class="mute accnote">${t('ov.filterHint')}</div>`)
    : '';
  return `<div class="mute">${t('ov.netWorth')}</div><div class="total ${o.netWorth < 0 ? 'up' : ''}">${eur(o.netWorth)}</div>${stats}${rows}`;
}

const accountRowHtml = ({ account: a, balance, warning }: AccountBalance, on: boolean): string =>
  `<button type="button" class="accrow${on ? ' on' : ''}" data-accf="${on ? '' : esc(a.id)}" aria-pressed="${on}"><span><span class="accname">${esc(a.name)}</span><small>${accountMeta(a)}${warning ? ` · <span class="up">${t('ov.negative')}</span>` : ''}</small></span><b class="${balance < 0 ? 'up' : ''}">${eur(balance)}</b></button>`;

/** Accounts in settings, with their balance and edit / archive / delete buttons. */
export const accountSettingsHtml = (balances: AccountBalance[]): string =>
  balances
    .map(
      ({ account: a, balance }) =>
        `<div class="row" style="grid-template-columns:1fr auto auto"><div>${esc(a.name)}<div class="mute">${accountMeta(a)}</div></div><b class="${balance < 0 ? 'up' : ''}">${eur(balance)}</b><div><button class="x" data-aedit="${a.id}" aria-label="${esc(t('common.edit'))}">✎</button><button type="button" class="linkbtn" data-aarch="${a.id}">${t(a.archived ? 'acc.unarchive' : 'acc.archive')}</button><button class="x" data-adel="${a.id}" aria-label="${esc(t('common.delete'))}">✕</button></div></div>`,
    )
    .join('');

/** Purchases money back can pay back, each with a share box; `shares` are the chosen ones. */
export const settleRowsHtml = (outstanding: Outstanding[], shares: Record<string, number>): string =>
  outstanding
    .map(
      ({ purchase: x, remaining }) =>
        `<label class="srow"><input type="checkbox" data-settle="${x.id}"${x.id in shares ? ' checked' : ''}><span>${esc(x.desc)} <span class="mute">${formatDmy(x.date)}, ${categoryLabel(x.cat, x.sub)}</span></span><span class="mute">${t('list.owed', { amount: eur(remaining) })}</span><input data-share="${x.id}" inputmode="decimal" aria-label="${esc(t('form.share'))}" value="${x.id in shares ? amountToInput(shares[x.id]!) : ''}"${x.id in shares ? '' : ' disabled'}></label>`,
    )
    .join('');

// ---- Settings ----

/** `open`: categories whose subcategory list is shown. Expense categories, then income ones. */
export function categoryEditorHtml(
  cats: Categories,
  usage: Record<string, number>,
  subs: Subcategories = {},
  open: Set<string> = new Set(),
  kinds: CategoryKinds = {},
): string {
  const block = (name: string): string => {
    const color = cats[name]!;
    const n = usage[name] || 0;
    const e = esc(name);
    const names = subs[name] || [];
    const colour = `<input type="color" value="${esc(color)}" data-cat-color="${e}" aria-label="${esc(t('cat.colourOf', { name }))}">`;
    const row = `<div class="erow">${colour}<input value="${e}" data-cat-name="${e}" maxlength="100" aria-label="${esc(t('common.name'))}"><button type="button" data-cat-rename="${e}">${t('cat.rename')}</button><button type="button" class="x" data-cat-delete="${e}" aria-label="${esc(t('cat.deleteNamed', { name }))}" title="${esc(tn('cat.txCount', n))}">✕</button></div>`;
    const chips = names
      .map(
        (s) =>
          `<span class="subchip">${esc(s)}<button type="button" class="x" data-sub-delete="${esc(s)}" data-sub-cat="${e}" aria-label="${esc(t('cat.deleteNamed', { name: s }))}">✕</button></span>`,
      )
      .join('');
    return `<div class="catblock" data-cat-row="${e}">${row}<details class="subs" data-subs="${e}"${open.has(name) ? ' open' : ''}><summary>${tn('sub.count', names.length)}</summary><div class="subchips">${chips}</div><div class="subadd"><input data-sub-new="${e}" placeholder="${esc(t('sub.new'))}" maxlength="100" aria-label="${esc(t('sub.newOf', { name }))}"><button type="button" data-sub-add="${e}">${t('common.add')}</button></div></details></div>`;
  };
  const group = (kind: CategoryKind, title: string) => {
    const names = categoryNamesOfKind(cats, kind, kinds);
    return names.length ? `<h3 class="subhead">${title}</h3>${names.map(block).join('')}` : '';
  };
  return group('expense', t('cat.expenses')) + group('income', t('cat.incomes')) || `<div class="mute">${t('cat.empty')}</div>`;
}

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
