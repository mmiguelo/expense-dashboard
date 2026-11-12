import {
  accountBalance,
  accountDeleteBlocker,
  categoryRows,
  expensesOf,
  frequentExpenses,
  heatmapDays,
  onAccount,
  outstandingPurchases,
  owedToYou,
  overview,
  percentChange,
  searchTransactions,
  summarize,
  topMerchants,
  trendBars,
  visibleTransactions,
  allocate,
} from '../analytics';
import { toCsv, parseBackup } from '../backup';
import { categoryNamesOfKind, guessCategory, guessSubcategory, kindOf, missingCategories, nextCategoryColor } from '../categories';
import { formatDmy, parseDmy, shiftRef, toIsoDate } from '../dates';
import { amountToInput, currencySymbol, parseAmount } from '../format';
import { t, tn, translateError } from '../i18n';
import { generateRecurring } from '../recurring';
import { lastAccount, saveLastAccount } from '../storage/preferences';
import type { Repository } from '../storage/repository';
import type {
  Account,
  Budgets,
  Categories,
  CategoryKind,
  CategoryKinds,
  GeneratedMonths,
  KeywordRule,
  LearnedCategories,
  Mode,
  RecurringExpense,
  Subcategories,
  Transaction,
  TransactionLink,
  TxType,
} from '../types';
import * as html from './render';

export interface AppOptions {
  doc: Document;
  repo: Repository;
  /** Current time; injectable for tests. */
  clock?: () => Date;
  /** Called when a reload finds the account deactivated. */
  onDeactivated?: () => void;
}

export interface AppHandle {
  /** Reload everything from the repository and re-render. */
  refresh(): Promise<void>;
  /** Show a short message at the bottom of the screen. */
  notify(message: string): void;
  /** Whether the user has any transactions (they lock the currency). */
  hasEntries(): boolean;
}

interface Data {
  /** The profile's currency, for new accounts. */
  currency: string;
  accounts: Account[];
  txs: Transaction[];
  links: TransactionLink[];
  rec: RecurringExpense[];
  bud: Budgets;
  cats: Categories;
  kinds: CategoryKinds;
  subs: Subcategories;
  learn: LearnedCategories;
  gen: GeneratedMonths;
  rules: KeywordRule[];
}

export async function startApp({ doc, repo, clock = () => new Date(), onDeactivated }: AppOptions): Promise<AppHandle> {
  const win = doc.defaultView!;
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => doc.getElementById(id) as T;
  const sel = (id: string) => $<HTMLSelectElement>(id);
  const today = () => toIsoDate(clock());
  /** The form's date field shows dd/mm/yyyy; these convert to and from YYYY-MM-DD. */
  const setFormDate = (iso: string) => {
    $('date').value = formatDmy(iso);
    $('date').setCustomValidity('');
  };
  const formDate = () => parseDmy($('date').value);
  const newId = () => crypto.randomUUID();

  let data: Data = { currency: 'EUR', accounts: [], txs: [], links: [], rec: [], bud: {}, cats: {}, kinds: {}, subs: {}, learn: {}, gen: {}, rules: [] };
  let mode: Mode = 'month';
  let ref = today();
  /** The user picked a category by hand, so stop auto-guessing it. */
  let touched = false;
  /** Same for the subcategory. */
  let subTouched = false;
  let editId: string | null = null;
  let lastDeleted: Transaction | null = null;
  let toastTimer: number | undefined;
  /** The account the dashboard is limited to, if any. */
  let accountFilter: string | null = null;
  /** Account being edited in settings. */
  let accountEditId: string | null = null;
  /** Category waiting for confirmation in the delete panel. */
  let deleting: string | null = null;

  async function load(): Promise<void> {
    const [profile, accounts, txs, links, rec, bud, cats, kinds, subs, learn, gen, rules] = await Promise.all([
      repo.getProfile(),
      repo.listAccounts(),
      repo.listTransactions(),
      repo.listLinks(),
      repo.listRecurring(),
      repo.getBudgets(),
      repo.getCategories(),
      repo.getCategoryKinds(),
      repo.getSubcategories(),
      repo.getLearnedCategories(),
      repo.getGeneratedMonths(),
      repo.listKeywordRules(),
    ]);
    if (!profile.active) {
      // The database already returns nothing; show why.
      onDeactivated?.();
      throw new Error(t('err.deactivated'));
    }
    data = { currency: profile.currency, accounts, txs, links, rec, bud, cats, kinds, subs, learn, gen, rules };
  }

  async function generateDueRecurring(): Promise<void> {
    // Rules on archived or deleted accounts wait until the account is open again.
    const closed = new Set(data.accounts.filter((a) => a.archived || a.deletedAt).map((a) => a.id));
    const rules = data.rec.filter((r) => !(r.acc && closed.has(r.acc)) && !(r.to && closed.has(r.to)));
    const due = generateRecurring(rules, data.gen, today(), newId);
    if (!due.length) return;
    await repo.addGeneratedRecurring(due);
    await load();
  }

  /**
   * Run a change through the repository, then reload and re-render. If it fails (e.g.
   * offline), say so and show what is actually stored.
   */
  async function update(change: () => Promise<unknown>, after: () => Promise<void> | void = render): Promise<boolean> {
    try {
      await change();
    } catch (e) {
      failed(e);
      await refresh().catch(() => {});
      return false;
    }
    try {
      await load();
      await after();
    } catch (e) {
      failed(e);
    }
    return true;
  }

  async function refresh(): Promise<void> {
    await load();
    await render();
  }

  function failed(e: unknown): void {
    console.error(e);
    toast(t('err.save', { message: translateError(String((e as Error)?.message ?? e)) }));
  }

  // ---- rendering ----

  /** Fill a subcategory select with `category`'s subcategories, keeping `value` if it is one. */
  function fillSubs(id: string, category: string, value = sel(id).value): void {
    const s = sel(id);
    s.innerHTML = html.subcategoryOptions(data.subs[category]);
    s.value = data.subs[category]?.includes(value) ? value : '';
    s.disabled = !data.subs[category]?.length;
  }

  /** The kind of category the form's type takes: income, or expense (also for money back). */
  const formKind = (): CategoryKind => (sel('type').value === 'i' ? 'income' : 'expense');

  /** The form's category select: the categories of the type's kind. */
  function fillFormCategories(value = sel('cat').value): void {
    const c = sel('cat');
    c.innerHTML = html.categoryOptionsOfKind(data.cats, formKind(), data.kinds);
    if (categoryNamesOfKind(data.cats, formKind(), data.kinds).includes(value)) c.value = value;
    fillSubs('subcat', c.value);
  }

  /**
   * The form's Account and To fields: shown only with more than one account, and Transfer
   * only offered then. Keeps the selected accounts when they are still there.
   */
  function fillAccounts(acc = sel('acc').value, to = sel('toAcc').value): void {
    // An entry being edited keeps its account even if that was archived since.
    const open = data.accounts.filter((a) => !a.deletedAt && (!a.archived || (editId !== null && (a.id === acc || a.id === to))));
    const ids = open.map((a) => a.id);
    sel('acc').innerHTML = sel('toAcc').innerHTML = html.accountOptions(open);
    const remembered = lastAccount();
    sel('acc').value = ids.includes(acc) ? acc : remembered && ids.includes(remembered) ? remembered : (ids[0] ?? '');
    sel('toAcc').value = ids.includes(to) && to !== sel('acc').value ? to : (ids.find((id) => id !== sel('acc').value) ?? '');
    $('accL').hidden = open.length < 2;
    sel('type').querySelector<HTMLOptionElement>('option[value="t"]')!.hidden = open.length < 2;
    applyTypeFields();
  }

  /** Transfers have a To account and no category. */
  /**
   * The form's Type: the transaction types, plus 'b' (money back), which is saved as an
   * expense with a negative amount.
   */
  const formType = () => sel('type').value as TxType | 'b';
  const savedType = (): TxType => (formType() === 'b' ? 'e' : (formType() as TxType));

  /** Transfers have a To account and no category; expenses can be reimbursable; money back settles purchases. */
  function applyTypeFields(): void {
    const type = formType();
    $('toL').hidden = type !== 't';
    $('catL').hidden = $('subL').hidden = type === 't' || type === 'a';
    // An adjustment asks for the balance the account should have; the difference is saved.
    $('amtLabel').textContent = t(type === 'a' ? 'form.correctBalance' : 'form.amount', { symbol: currencySymbol() });
    $('reimbL').hidden = type !== 'e';
    fillSettle();
  }

  /** Shares of the money back being entered, by purchase id. */
  let shares: Record<string, number> = {};

  /** Purchases the money back can pay back: those still owed, plus those it already settles. */
  function fillSettle(): void {
    const outstanding = formType() === 'b' ? outstandingPurchases(visibleTransactions(data.txs, data.accounts), data.links, editId ?? undefined) : [];
    for (const id of Object.keys(shares)) if (!outstanding.some((o) => o.purchase.id === id)) delete shares[id];
    $('settleBox').hidden = !outstanding.length;
    $('settleList').innerHTML = html.settleRowsHtml(outstanding, shares);
  }

  $('settleList').addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    const id = el.dataset.settle ?? el.dataset.share;
    if (!id) return;
    if (el.dataset.share) {
      const v = parseAmount(el.value);
      shares[id] = Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
      return;
    }
    if (el.checked) {
      const outstanding = outstandingPurchases(visibleTransactions(data.txs, data.accounts), data.links, editId ?? undefined);
      const purchase = outstanding.find((o) => o.purchase.id === id)!;
      const typed = parseAmount($('amt').value);
      const left = (Number.isFinite(typed) ? typed : purchase.remaining) - Object.values(shares).reduce((a, b) => a + b, 0);
      shares[id] = allocate(Math.max(left, 0), [purchase.remaining])[0] || purchase.remaining;
      // Money back goes in the purchase's category, unless one was picked.
      if (!touched && Object.keys(shares).length === 1) {
        fillFormCategories(purchase.purchase.cat);
        fillSubs('subcat', sel('cat').value, purchase.purchase.sub || '');
        if (!$('desc').value.trim()) $('desc').value = purchase.purchase.desc;
      }
    } else delete shares[id];
    fillSettle();
  });

  function fillSelects(): void {
    const selects = [sel('fc'), sel('kwNewCat')];
    const values = selects.map((s) => s.value);
    selects[0]!.innerHTML = html.categoryOptions(data.cats, true, true, data.kinds);
    selects[1]!.innerHTML = html.categoryOptions(data.cats, true, false, data.kinds);
    selects.forEach((s, i) => {
      if (values[i]) s.value = values[i]!;
    });
    fillFormCategories();
    fillAccounts();
    fillRecurringForm();
  }

  /** The recurring form: categories of its type's kind, accounts when there are several, To for transfers. */
  function fillRecurringForm(): void {
    const type = sel('rtype').value;
    const open = data.accounts.filter((a) => !a.deletedAt && !a.archived);
    const ids = open.map((a) => a.id);
    const [acc, to, cat] = [sel('racc').value, sel('rto').value, sel('rc').value];
    sel('racc').innerHTML = sel('rto').innerHTML = html.accountOptions(open);
    sel('racc').value = ids.includes(acc) ? acc : (ids[0] ?? '');
    sel('rto').value = ids.includes(to) && to !== sel('racc').value ? to : (ids.find((id) => id !== sel('racc').value) ?? '');
    sel('rtype').querySelector<HTMLOptionElement>('option[value="t"]')!.hidden = open.length < 2;
    $('raccL').hidden = open.length < 2;
    $('rtoL').hidden = type !== 't';
    $('rcL').hidden = $('rsubL').hidden = type === 't';
    sel('rc').innerHTML = html.categoryOptionsOfKind(data.cats, type === 'i' ? 'income' : 'expense', data.kinds);
    if ([...sel('rc').options].some((o) => o.value === cat)) sel('rc').value = cat;
    fillSubs('rsub', sel('rc').value);
  }

  /** What the dashboard shows: no deleted entries or accounts, limited to the chosen account. */
  function shownTransactions(): Transaction[] {
    const visible = visibleTransactions(data.txs, data.accounts);
    return accountFilter ? onAccount(visible, accountFilter) : visible;
  }

  function renderList(): void {
    const list = searchTransactions(shownTransactions(), ref, mode, $('q').value, sel('fc').value);
    const owed = Object.fromEntries(outstandingPurchases(data.txs, data.links).map((o) => [o.purchase.id, o.remaining]));
    $('list').innerHTML = html.transactionListHtml(list, data.cats, data.accounts, owed);
  }

  function renderSettings(): void {
    $('bud').innerHTML = html.budgetInputsHtml(data.cats, data.bud, data.kinds);
    doc.querySelectorAll<HTMLInputElement>('[data-b]').forEach((i) =>
      i.addEventListener('change', () => {
        const v = parseAmount(i.value);
        void update(() => repo.setBudget(i.dataset.b!, v > 0 ? v : null));
      }),
    );
    $('rlist').innerHTML = html.recurringListHtml(data.rec, data.cats, data.accounts);
    $('alist').innerHTML = html.accountSettingsHtml(overview(data.accounts, data.txs).balances);
    $('adeleted').innerHTML = html.deletedAccountsHtml(data.accounts.filter((a) => a.deletedAt));
    $('dlist').innerHTML = html.deletedTransactionsHtml(data.txs);
    const open = new Set([...doc.querySelectorAll<HTMLDetailsElement>('[data-subs]')].filter((d) => d.open).map((d) => d.dataset.subs!));
    $('catList').innerHTML = html.categoryEditorHtml(data.cats, categoryUsage(), data.subs, open, data.kinds);
    renderRules();
    if (deleting && !data.cats[deleting]) closeDeletePanel();
  }

  const renderRules = () => ($('kwList').innerHTML = html.keywordRulesHtml(data.rules, data.cats, $('kwFilter').value));

  /** Income, expenses and recurring expenses per category. */
  function categoryUsage(): Record<string, number> {
    const n: Record<string, number> = {};
    for (const x of data.txs) if (x.type === 'e' || x.type === 'i') n[x.cat] = (n[x.cat] || 0) + 1;
    for (const r of data.rec) n[r.cat] = (n[r.cat] || 0) + 1;
    return n;
  }

  async function render(): Promise<void> {
    await generateDueRecurring();
    fillSelects();
    const o = overview(data.accounts, data.txs);
    if (accountFilter && !o.balances.some((b) => b.account.id === accountFilter)) accountFilter = null;
    $('ov').hidden = false;
    $('ovBody').innerHTML = html.overviewHtml(o, accountFilter, owedToYou(visibleTransactions(data.txs, data.accounts), data.links));
    const txs = shownTransactions();
    const s = summarize(txs, ref, mode, today(), data.accounts);
    $('lbl').textContent = html.periodLabel(ref, mode);
    $('sum').innerHTML = html.summaryHtml(s, mode, percentChange(s.total, s.previousTotal));
    $('tT').textContent = html.trendTitle(mode);
    $('trend').innerHTML = html.trendHtml(trendBars(expensesOf(txs), ref, mode), data.cats);
    $('donut').innerHTML = html.donutHtml(s, data.cats);
    $('cats').innerHTML = html.categoryRowsHtml(categoryRows(s, data.bud, mode), data.cats);
    $('heatC').style.display = mode === 'day' ? 'none' : '';
    if (mode !== 'day') $('heat').innerHTML = html.heatmapHtml(heatmapDays(s.expenses, ref, mode));
    $('top').innerHTML = html.topMerchantsHtml(topMerchants(s.expenses));
    renderList();
    $('chips').innerHTML = html.quickPicksHtml(frequentExpenses(expensesOf(visibleTransactions(data.txs, data.accounts))));
    renderSettings();
  }

  // ---- transaction form ----

  function resetForm(): void {
    editId = null;
    touched = false;
    subTouched = false;
    ['amt', 'desc', 'tags'].forEach((i) => ($(i).value = ''));
    sel('type').value = 'e';
    $<HTMLInputElement>('reimb').checked = false;
    shares = {};
    setFormDate(ref);
    fillFormCategories();
    fillAccounts('', '');
    fillSubs('subcat', sel('cat').value, '');
    $('sub').textContent = t('form.add');
    $('cancel').hidden = true;
    $('fT').textContent = t('form.addTitle');
  }

  async function submitTransaction(): Promise<void> {
    const amount = parseAmount($('amt').value);
    const date = formDate();
    if (!date) {
      $('date').setCustomValidity(t('form.badDate'));
      $('date').reportValidity();
      return;
    }
    const adjust = formType() === 'a';
    if (adjust ? !Number.isFinite(amount) : !(amount > 0)) return;
    const back = formType() === 'b';
    const type = savedType();
    const settles = back ? Object.entries(shares).filter(([, a]) => a > 0).map(([purchase, a]) => ({ purchase, amount: a })) : [];
    if (settles.reduce((s, l) => s + l.amount, 0) > amount + 0.001) return toast(t('form.settleTooMuch'));
    const desc = $('desc').value.trim();
    const acc = sel('acc').value;
    const transfer = type === 't';
    const to = sel('toAcc').value;
    if (transfer && (!to || to === acc)) {
      sel('toAcc').setCustomValidity(t('form.sameAccount'));
      sel('toAcc').reportValidity();
      return;
    }
    const cat = transfer || adjust ? '' : sel('cat').value;
    const sub = transfer || adjust ? '' : sel('subcat').value;
    let value = back ? -amount : amount;
    if (adjust) {
      const account = data.accounts.find((a) => a.id === acc);
      if (!account) return;
      value = Math.round((amount - balanceBefore(account, date)) * 100) / 100;
      if (Math.abs(value) < 0.005) return toast(t('form.adjustNone'));
    }
    const toName = data.accounts.find((a) => a.id === to)?.name ?? '';
    const fields = { date, amount: value, desc: desc || sub || cat || (adjust ? t('form.adjustment') : toName), cat, sub, type, tags: $('tags').value.trim(), acc };
    let tx: Transaction;
    if (editId !== null) {
      const existing = data.txs.find((z) => z.id === editId);
      if (!existing) return;
      const { to: _to, toAmt: _toAmt, reimb: _reimb, ...rest } = existing;
      tx = { ...rest, ...fields };
    } else tx = { id: newId(), ...fields };
    if (transfer) Object.assign(tx, { to, toAmt: amount });
    if (formType() === 'e' && $<HTMLInputElement>('reimb').checked) tx.reimb = 1;
    const hadLinks = data.links.some((l) => l.repayment === tx.id);
    const learn = formType() === 'e' && desc && touched;
    // On failure the form keeps what was typed, so it can be submitted again.
    await update(
      async () => {
        if (learn) await repo.learnCategory(desc, cat);
        await repo.saveTransaction(tx);
        if (settles.length || hadLinks) await repo.setLinks(tx.id, settles);
        saveLastAccount(acc);
      },
      () => {
        ref = fields.date;
        resetForm();
        return render();
      },
    );
  }

  /** An account's balance at the end of `date`, leaving out the entry being edited. */
  const balanceBefore = (account: Account, date: string) => accountBalance(account, data.txs.filter((x) => x.id !== editId), date);

  function startEdit(x: Transaction): void {
    editId = x.id;
    const back = x.type === 'e' && x.amount < 0;
    sel('type').value = back ? 'b' : x.type;
    setFormDate(x.date);
    const account = data.accounts.find((a) => a.id === x.acc);
    $('amt').value = amountToInput(
      x.type === 'a' && account ? Math.round((balanceBefore(account, x.date) + x.amount) * 100) / 100 : Math.abs(x.amount),
    );
    $<HTMLInputElement>('reimb').checked = !!x.reimb;
    shares = Object.fromEntries(data.links.filter((l) => l.repayment === x.id).map((l) => [l.purchase, l.amount]));
    $('desc').value = x.desc;
    $('tags').value = x.tags || '';
    fillFormCategories(x.cat);
    fillSubs('subcat', sel('cat').value, x.sub || '');
    fillAccounts(x.acc ?? '', x.to ?? '');
    touched = false;
    subTouched = false;
    $('sub').textContent = t('form.save');
    $('cancel').hidden = false;
    $('fT').textContent = t('form.editTitle');
    $('f').scrollIntoView({ behavior: 'smooth' });
  }

  $('desc').addEventListener('input', () => {
    const text = $('desc').value;
    if (sel('type').value === 't') return;
    if (touched) {
      const s = guessSubcategory(text, data.subs, sel('cat').value);
      if (s && !subTouched) sel('subcat').value = s.sub;
      return;
    }
    // A keyword rule or learned merchant decides the category; a subcategory named in
    // the description (e.g. "Netflix") fills in the rest, or the category when no rule matched.
    const kind = formKind();
    const guessed = guessCategory(text, data.learn, data.rules, data.cats);
    // Only a category of the form's kind: an income rule doesn't turn an expense into income.
    const g = guessed && kindOf(guessed, data.kinds) === kind ? guessed : null;
    const s = guessSubcategory(text, data.subs, g ?? undefined, categoryNamesOfKind(data.cats, kind, data.kinds));
    const cat = g ?? s?.cat;
    if (!cat) return;
    if (cat !== sel('cat').value) {
      sel('cat').value = cat;
      fillSubs('subcat', cat, '');
    }
    if (s && !subTouched) sel('subcat').value = s.sub;
  });
  sel('cat').addEventListener('change', () => {
    touched = true;
    fillSubs('subcat', sel('cat').value, '');
  });
  sel('subcat').addEventListener('change', () => (subTouched = true));
  sel('type').addEventListener('change', () => {
    subTouched = false;
    fillFormCategories();
    applyTypeFields();
  });
  sel('acc').addEventListener('change', () => fillAccounts());
  sel('toAcc').addEventListener('change', () => sel('toAcc').setCustomValidity(''));
  sel('rc').addEventListener('change', () => fillSubs('rsub', sel('rc').value, ''));
  sel('rtype').addEventListener('change', fillRecurringForm);
  sel('racc').addEventListener('change', fillRecurringForm);
  $('cancel').addEventListener('click', resetForm);
  $('sub').addEventListener('click', () => void submitTransaction());
  $('date').addEventListener('input', () => $('date').setCustomValidity(''));
  $('date').addEventListener('blur', () => {
    const iso = formDate();
    if (iso) setFormDate(iso); // tidy 4/11/26 into 04/11/2026
  });
  $('dateBtn').addEventListener('click', () => {
    const pick = $('datePick');
    pick.value = formDate() ?? ref;
    try {
      pick.showPicker();
    } catch {
      pick.focus();
    }
  });
  $('datePick').addEventListener('change', () => {
    if ($('datePick').value) setFormDate($('datePick').value);
    $('date').focus();
  });
  ['date', 'amt', 'desc', 'tags'].forEach((i) =>
    $(i).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void submitTransaction();
    }),
  );

  // ---- period navigation and filters ----

  $('modes').addEventListener('click', (e) => {
    const m = (e.target as HTMLElement).dataset.m as Mode | undefined;
    if (!m) return;
    mode = m;
    doc.querySelectorAll<HTMLElement>('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    void render();
  });
  $('prev').addEventListener('click', () => {
    ref = shiftRef(ref, -1, mode);
    void render();
  });
  $('next').addEventListener('click', () => {
    ref = shiftRef(ref, 1, mode);
    void render();
  });
  $('today').addEventListener('click', () => {
    ref = today();
    void render();
  });
  $('q').addEventListener('input', renderList);
  sel('fc').addEventListener('change', renderList);

  // ---- delete with undo ----

  function toast(message: string, withUndo = false): void {
    $('tm').textContent = message;
    $('undo').hidden = !withUndo;
    $('toast').style.display = 'flex';
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => ($('toast').style.display = 'none'), 6000);
  }

  $('undo').addEventListener('click', () => {
    const tx = lastDeleted;
    lastDeleted = null;
    $('toast').style.display = 'none';
    if (tx) void update(() => repo.saveTransaction(tx));
  });

  doc.addEventListener('click', (e) => {
    const d = (e.target as HTMLElement).dataset;
    if (d.del) {
      const x = data.txs.find((t) => String(t.id) === d.del);
      if (!x) return;
      lastDeleted = x;
      // Soft delete: it stops counting and can be restored from Settings.
      void update(
        () => repo.saveTransaction({ ...x, del: new Date().toISOString() }),
        async () => {
          await render();
          toast(t('tx.deleted'), true);
        },
      );
    }
    if (d.trestore) {
      const x = data.txs.find((t) => t.id === d.trestore);
      if (!x) return;
      const { del: _del, ...restored } = x;
      void update(
        () => repo.saveTransaction(restored),
        async () => {
          await render();
          toast(t('tx.restored'));
        },
      );
    }
    if (d.edit) {
      const x = data.txs.find((t) => String(t.id) === d.edit);
      if (x) startEdit(x);
    }
    if (d.rdel) void update(() => repo.deleteRecurring(d.rdel!), renderSettings);
    if (d.chip) {
      const c = JSON.parse(d.chip);
      sel('type').value = 'e';
      applyTypeFields();
      $('desc').value = c.desc;
      fillFormCategories(c.cat);
      fillSubs('subcat', sel('cat').value, c.sub || '');
      $('amt').value = amountToInput(c.amount);
      $('amt').focus();
      $('amt').select();
    }
  });

  // ---- settings ----

  $('rb').addEventListener('click', () => {
    const amount = parseAmount($('ra').value);
    const desc = $('rd').value.trim();
    if (!(amount > 0) || !desc) return;
    const type = sel('rtype').value as 'e' | 'i' | 't';
    const transfer = type === 't';
    if (transfer && (!sel('rto').value || sel('rto').value === sel('racc').value)) return toast(t('form.sameAccount'));
    const rule: RecurringExpense = {
      id: newId(),
      desc,
      amount,
      cat: transfer ? '' : sel('rc').value,
      ...(!transfer && sel('rsub').value ? { sub: sel('rsub').value } : {}),
      day: +$('rday').value || 1,
      start: today().slice(0, 7),
      ...(type !== 'e' ? { type } : {}),
      ...(sel('racc').value ? { acc: sel('racc').value } : {}),
      ...(transfer ? { to: sel('rto').value } : {}),
    };
    ['rd', 'ra'].forEach((i) => ($(i).value = ''));
    void update(() => repo.saveRecurring(rule));
  });

  // ---- settings: categories and keyword rules ----

  $('ncb').addEventListener('click', () => {
    const name = $('nc').value.trim();
    if (!name) return;
    if (data.cats[name]) return toast(t('cat.exists', { name }));
    $('nc').value = '';
    const color = $('ncc').value;
    $('ncc').value = nextCategoryColor({ ...data.cats, [name]: color });
    void update(() => repo.saveCategory(name, color, sel('nck').value as CategoryKind));
  });

  function closeDeletePanel(): void {
    deleting = null;
    $('catDelete').hidden = true;
  }

  function openDeletePanel(name: string): void {
    deleting = name;
    const n = categoryUsage()[name] || 0;
    const others = categoryNamesOfKind(data.cats, kindOf(name, data.kinds), data.kinds).filter((c) => c !== name);
    if (!others.length) return toast(t('cat.lastOfKind'));
    $('catDeleteText').textContent = n ? tn('catDel.used', n, { name }) : t('catDel.unused', { name });
    $('catDeleteMoveLabel').hidden = !n;
    sel('catDeleteTo').innerHTML = others.map((c) => `<option>${html.escape(c)}</option>`).join('');
    $<HTMLButtonElement>('catDeleteOk').disabled = n > 0 && !others.length;
    $('catDelete').hidden = false;
    $('catDelete').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('catDeleteCancel').addEventListener('click', closeDeletePanel);
  $('catDeleteOk').addEventListener('click', () => {
    const name = deleting;
    if (!name) return;
    const moveTo = (categoryUsage()[name] || 0) > 0 ? sel('catDeleteTo').value : null;
    void update(
      () => repo.deleteCategory(name, moveTo),
      async () => {
        closeDeletePanel();
        await render();
        toast(moveTo ? t('catDel.doneMoved', { name, to: moveTo }) : t('catDel.done', { name }));
      },
    );
  });

  $('catList').addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.catColor) void update(() => repo.saveCategory(el.dataset.catColor!, el.value));
  });

  function addSubcategory(category: string): void {
    const input = [...doc.querySelectorAll<HTMLInputElement>('[data-sub-new]')].find((i) => i.dataset.subNew === category);
    const name = input?.value.trim();
    if (!name) return;
    if (data.subs[category]?.includes(name)) return toast(t('sub.exists', { cat: category, name }));
    void update(() => repo.addSubcategory(category, name));
  }

  $('catList').addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (e.key === 'Enter' && el.dataset.subNew) addSubcategory(el.dataset.subNew);
  });

  $('catList').addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el.dataset.subAdd) addSubcategory(el.dataset.subAdd);
    if (el.dataset.subDelete && el.dataset.subCat) {
      const [category, name] = [el.dataset.subCat, el.dataset.subDelete];
      const n =
        data.txs.filter((x) => x.cat === category && x.sub === name).length + data.rec.filter((r) => r.cat === category && r.sub === name).length;
      if (n && !win.confirm(tn('sub.confirmDelete', n, { name, cat: category }))) return;
      void update(() => repo.deleteSubcategory(category, name));
    }
    if (el.dataset.catDelete) openDeletePanel(el.dataset.catDelete);
    if (el.dataset.catRename) {
      const old = el.dataset.catRename;
      const input = [...doc.querySelectorAll<HTMLInputElement>('[data-cat-name]')].find((i) => i.dataset.catName === old)!;
      const name = input.value.trim();
      if (!name || name === old) return;
      if (data.cats[name]) return toast(t('cat.exists', { name }));
      void update(
        () => repo.renameCategory(old, name),
        async () => {
          await render();
          toast(t('cat.renamed', { old, name }));
        },
      );
    }
  });

  $('kwAdd').addEventListener('click', () => {
    const keyword = $('kwNew').value.toLowerCase();
    if (!keyword.trim()) return;
    if (data.rules.some((r) => r.keyword === keyword)) return toast(t('rules.exists', { keyword }));
    $('kwNew').value = '';
    void update(() => repo.saveKeywordRule({ keyword, category: sel('kwNewCat').value }));
  });
  $('kwFilter').addEventListener('input', renderRules);
  $('kwList').addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    const rule = data.rules.find((r) => String(r.id) === el.dataset.ruleCat);
    if (rule) void update(() => repo.saveKeywordRule({ ...rule, category: el.value }));
  });
  $('kwList').addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).dataset.ruleDelete;
    if (id) void update(() => repo.deleteKeywordRule(Number(id)));
  });

  function download(name: string, text: string, type: string): void {
    const a = doc.createElement('a');
    a.href = win.URL.createObjectURL(new win.Blob([text], { type }));
    a.download = name;
    a.click();
  }

  const exporting = (run: () => Promise<void>) => () =>
    run().catch((e) => toast(t('export.failed', { message: translateError(String((e as Error)?.message ?? e)) })));
  $('xj').addEventListener(
    'click',
    exporting(async () => download('expenses-backup.json', JSON.stringify(await repo.exportSnapshot()), 'application/json')),
  );
  $('xc').addEventListener('click', exporting(async () => download('expenses.csv', toCsv(await repo.listTransactions(), await repo.listAccounts()), 'text/csv')));

  /** Read the backup picked in a file input; alerts and returns null if it isn't one. */
  async function pickedBackup(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return null;
    const backup = parseBackup(await f.text());
    input.value = '';
    if (!backup) win.alert(t('backup.invalid'));
    return backup;
  }

  $('imp').addEventListener('change', async (e) => {
    const backup = await pickedBackup(e);
    if (!backup || !win.confirm(t('backup.confirmReplace'))) return;
    await update(
      () => repo.importSnapshot(backup, { replace: true }),
      async () => {
        await render();
        toast(t('backup.imported'));
      },
    );
  });

  $('impMerge').addEventListener('change', async (e) => {
    const backup = await pickedBackup(e);
    if (!backup) return;
    let result = { transactions: 0, skipped: 0 };
    await update(
      async () => (result = await repo.importSnapshot(backup, { replace: false })),
      async () => {
        await render();
        toast(importMessage(result));
      },
    );
  });

  // ---- accounts ----

  function resetAccountForm(): void {
    accountEditId = null;
    ['an', 'ab', 'ai'].forEach((i) => ($(i).value = ''));
    sel('ak').value = 'checking';
    $('ad').value = today();
    $('asave').textContent = t('acc.add');
    $('acancel').hidden = true;
  }

  function editAccount(a: Account): void {
    accountEditId = a.id;
    $('an').value = a.name;
    sel('ak').value = a.kind;
    $('ab').value = a.openingBalance ? amountToInput(a.openingBalance) : '';
    $('ad').value = a.openingDate;
    $('ai').value = a.institution;
    $('asave').textContent = t('acc.save');
    $('acancel').hidden = false;
    $('an').focus();
  }

  function saveAccountForm(): void {
    const name = $('an').value.trim();
    if (!name) {
      $('an').setCustomValidity(t('acc.nameRequired'));
      $('an').reportValidity();
      return;
    }
    const raw = $('ab').value.trim();
    const openingBalance = raw ? parseAmount(raw) : 0;
    if (!Number.isFinite(openingBalance)) {
      $('ab').reportValidity();
      return;
    }
    const fields = {
      name,
      kind: sel('ak').value as Account['kind'],
      openingBalance: Math.round(openingBalance * 100) / 100,
      openingDate: $('ad').value || today(),
      institution: $('ai').value.trim(),
    };
    const existing = data.accounts.find((a) => a.id === accountEditId);
    const account: Account = existing
      ? { ...existing, ...fields }
      : { id: newId(), currency: data.currency, archived: false, ...fields };
    void update(() => repo.saveAccount(account), () => {
      resetAccountForm();
      return render();
    });
  }

  function changeAccount(id: string, change: (a: Account) => Account): void {
    const a = data.accounts.find((x) => x.id === id);
    if (a) void update(() => repo.saveAccount(change(a)));
  }

  sel('ak').innerHTML = html.kindOptions();
  resetAccountForm();
  $('an').addEventListener('input', () => $('an').setCustomValidity(''));
  $('asave').addEventListener('click', saveAccountForm);
  $('acancel').addEventListener('click', resetAccountForm);
  doc.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-accf],[data-aedit],[data-aarch],[data-adel],[data-arestore]');
    if (!el) return;
    const d = el.dataset;
    if (d.accf !== undefined) {
      accountFilter = d.accf || null;
      void render();
    } else if (d.aedit) {
      const a = data.accounts.find((x) => x.id === d.aedit);
      if (a) editAccount(a);
    } else if (d.aarch) {
      const a = data.accounts.find((x) => x.id === d.aarch);
      if (!a) return;
      if (!a.archived && accountDeleteBlocker(a, data.accounts, []) === 'last') return toast(t('acc.blocked.last'));
      changeAccount(a.id, (x) => ({ ...x, archived: !x.archived }));
    } else if (d.adel) {
      const a = data.accounts.find((x) => x.id === d.adel);
      if (!a) return;
      const blocker = accountDeleteBlocker(a, data.accounts, data.txs);
      if (blocker) return toast(t(blocker === 'last' ? 'acc.blocked.last' : 'acc.blocked.transfers'));
      if (!win.confirm(t('acc.confirmDelete', { name: a.name }))) return;
      if (accountEditId === a.id) resetAccountForm();
      changeAccount(a.id, (x) => ({ ...x, deletedAt: new Date().toISOString() }));
    } else if (d.arestore) {
      changeAccount(d.arestore, ({ deletedAt: _deletedAt, ...x }) => x);
    }
  });

  // ---- start ----

  setFormDate(ref);
  await load();
  // Categories used by old data but missing from the list get a colour.
  for (const [name, color] of Object.entries(missingCategories(data.txs, data.cats))) await repo.saveCategory(name, color);
  await refresh();
  return { refresh, notify: (m) => toast(m), hasEntries: () => data.txs.length > 0 };
}

export const importMessage = ({ transactions, skipped }: { transactions: number; skipped: number }): string =>
  tn('import.done', transactions) + (skipped ? t('import.skipped', { n: skipped }) : '');
