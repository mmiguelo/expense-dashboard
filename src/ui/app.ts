import {
  categoryRows,
  expensesOf,
  frequentExpenses,
  heatmapDays,
  percentChange,
  searchTransactions,
  summarize,
  topMerchants,
  trendBars,
} from '../analytics';
import { toCsv, parseBackup } from '../backup';
import { expenseCategoryNames, guessCategory, fixedCategoryOf, guessSubcategory, isIncomeCategory, missingCategories, nextCategoryColor } from '../categories';
import { formatDmy, parseDmy, shiftRef, toIsoDate } from '../dates';
import { amountToInput, parseAmount } from '../format';
import { t, tn, translateError } from '../i18n';
import { generateRecurring } from '../recurring';
import type { Repository } from '../storage/repository';
import type {
  Budgets,
  Categories,
  GeneratedMonths,
  KeywordRule,
  LearnedCategories,
  Mode,
  RecurringExpense,
  Subcategories,
  Transaction,
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
}

interface Data {
  txs: Transaction[];
  rec: RecurringExpense[];
  bud: Budgets;
  cats: Categories;
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

  let data: Data = { txs: [], rec: [], bud: {}, cats: {}, subs: {}, learn: {}, gen: {}, rules: [] };
  let mode: Mode = 'month';
  let ref = today();
  /** The user picked a category by hand, so stop auto-guessing it. */
  let touched = false;
  /** Same for the subcategory. */
  let subTouched = false;
  let editId: string | null = null;
  let lastDeleted: Transaction | null = null;
  let toastTimer: number | undefined;
  /** Category waiting for confirmation in the delete panel. */
  let deleting: string | null = null;

  async function load(): Promise<void> {
    const [profile, txs, rec, bud, cats, subs, learn, gen, rules] = await Promise.all([
      repo.getProfile(),
      repo.listTransactions(),
      repo.listRecurring(),
      repo.getBudgets(),
      repo.getCategories(),
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
    data = { txs, rec, bud, cats, subs, learn, gen, rules };
  }

  async function generateDueRecurring(): Promise<void> {
    const due = generateRecurring(data.rec, data.gen, today(), newId);
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

  /** The form's category select: expense categories, or the fixed one of income or savings. */
  function fillFormCategories(value = sel('cat').value): void {
    const fixed = fixedCategoryOf(sel('type').value as TxType);
    const c = sel('cat');
    c.innerHTML = fixed ? `<option>${html.escape(fixed)}</option>` : html.categoryOptions(data.cats);
    c.disabled = !!fixed;
    if (!fixed && expenseCategoryNames(data.cats).includes(value)) c.value = value;
    fillSubs('subcat', c.value);
  }

  function fillSelects(): void {
    const selects = [sel('fc'), sel('rc'), sel('kwNewCat')];
    const values = selects.map((s) => s.value);
    selects[0]!.innerHTML = html.categoryOptions(data.cats, true, true);
    selects[1]!.innerHTML = html.categoryOptions(data.cats);
    selects[2]!.innerHTML = html.categoryOptions(data.cats);
    selects.forEach((s, i) => {
      if (values[i]) s.value = values[i]!;
    });
    fillFormCategories();
    fillSubs('rsub', sel('rc').value);
  }

  function renderList(): void {
    const list = searchTransactions(data.txs, ref, mode, $('q').value, sel('fc').value);
    $('list').innerHTML = html.transactionListHtml(list, data.cats);
  }

  function renderSettings(): void {
    $('bud').innerHTML = html.budgetInputsHtml(data.cats, data.bud);
    doc.querySelectorAll<HTMLInputElement>('[data-b]').forEach((i) =>
      i.addEventListener('change', () => {
        const v = parseAmount(i.value);
        void update(() => repo.setBudget(i.dataset.b!, v > 0 ? v : null));
      }),
    );
    $('rlist').innerHTML = html.recurringListHtml(data.rec, data.cats);
    const open = new Set([...doc.querySelectorAll<HTMLDetailsElement>('[data-subs]')].filter((d) => d.open).map((d) => d.dataset.subs!));
    $('catList').innerHTML = html.categoryEditorHtml(data.cats, categoryUsage(), data.subs, open);
    renderRules();
    if (deleting && !data.cats[deleting]) closeDeletePanel();
  }

  const renderRules = () => ($('kwList').innerHTML = html.keywordRulesHtml(data.rules, data.cats, $('kwFilter').value));

  /** Expenses and recurring expenses per category. */
  function categoryUsage(): Record<string, number> {
    const n: Record<string, number> = {};
    for (const x of data.txs) if (x.type === 'e') n[x.cat] = (n[x.cat] || 0) + 1;
    for (const r of data.rec) n[r.cat] = (n[r.cat] || 0) + 1;
    return n;
  }

  async function render(): Promise<void> {
    await generateDueRecurring();
    fillSelects();
    const s = summarize(data.txs, ref, mode, today());
    $('lbl').textContent = html.periodLabel(ref, mode);
    $('sum').innerHTML = html.summaryHtml(s, mode, percentChange(s.total, s.previousTotal));
    $('tT').textContent = html.trendTitle(mode);
    $('trend').innerHTML = html.trendHtml(trendBars(expensesOf(data.txs), ref, mode), data.cats);
    $('donut').innerHTML = html.donutHtml(s, data.cats);
    $('cats').innerHTML = html.categoryRowsHtml(categoryRows(s, data.bud, mode), data.cats);
    $('heatC').style.display = mode === 'day' ? 'none' : '';
    if (mode !== 'day') $('heat').innerHTML = html.heatmapHtml(heatmapDays(s.expenses, ref, mode));
    $('top').innerHTML = html.topMerchantsHtml(topMerchants(s.expenses));
    renderList();
    $('chips').innerHTML = html.quickPicksHtml(frequentExpenses(expensesOf(data.txs)));
    renderSettings();
  }

  // ---- transaction form ----

  function resetForm(): void {
    editId = null;
    touched = false;
    subTouched = false;
    ['amt', 'desc', 'tags'].forEach((i) => ($(i).value = ''));
    sel('type').value = 'e';
    setFormDate(ref);
    fillFormCategories();
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
    if (!(amount > 0)) return;
    const type = sel('type').value as TxType;
    const desc = $('desc').value.trim();
    const cat = fixedCategoryOf(type) ?? sel('cat').value;
    const sub = sel('subcat').value;
    const fields = { date, amount, desc: desc || sub || cat, cat, sub, type, tags: $('tags').value.trim() };
    let tx: Transaction;
    if (editId !== null) {
      const existing = data.txs.find((z) => z.id === editId);
      if (!existing) return;
      tx = { ...existing, ...fields };
    } else tx = { id: newId(), ...fields };
    const learn = type === 'e' && desc && touched;
    // On failure the form keeps what was typed, so it can be submitted again.
    await update(
      async () => {
        if (learn) await repo.learnCategory(desc, cat);
        await repo.saveTransaction(tx);
      },
      () => {
        ref = fields.date;
        resetForm();
        return render();
      },
    );
  }

  function startEdit(x: Transaction): void {
    editId = x.id;
    sel('type').value = x.type;
    setFormDate(x.date);
    $('amt').value = amountToInput(x.amount);
    $('desc').value = x.desc;
    $('tags').value = x.tags || '';
    fillFormCategories(x.cat);
    fillSubs('subcat', sel('cat').value, x.sub || '');
    touched = false;
    subTouched = false;
    $('sub').textContent = t('form.save');
    $('cancel').hidden = false;
    $('fT').textContent = t('form.editTitle');
    $('f').scrollIntoView({ behavior: 'smooth' });
  }

  $('desc').addEventListener('input', () => {
    const text = $('desc').value;
    const fixed = fixedCategoryOf(sel('type').value as TxType);
    if (fixed) {
      const s = guessSubcategory(text, data.subs, fixed);
      if (s && !subTouched) sel('subcat').value = s.sub;
      return;
    }
    if (touched) {
      const s = guessSubcategory(text, data.subs, sel('cat').value);
      if (s && !subTouched) sel('subcat').value = s.sub;
      return;
    }
    // A keyword rule or learned merchant decides the category; a subcategory named in
    // the description (e.g. "Netflix") fills in the rest, or the category when no rule matched.
    const g = guessCategory(text, data.learn, data.rules, data.cats);
    const s = guessSubcategory(text, data.subs, g ?? undefined);
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
  });
  sel('rc').addEventListener('change', () => fillSubs('rsub', sel('rc').value, ''));
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
      void update(
        () => repo.deleteTransaction(x.id),
        async () => {
          await render();
          toast(t('tx.deleted'), true);
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
    const rule: RecurringExpense = {
      id: newId(),
      desc,
      amount,
      cat: sel('rc').value,
      ...(sel('rsub').value ? { sub: sel('rsub').value } : {}),
      day: +$('rday').value || 1,
      start: today().slice(0, 7),
    };
    ['rd', 'ra'].forEach((i) => ($(i).value = ''));
    void update(() => repo.saveRecurring(rule));
  });

  // ---- settings: categories and keyword rules ----

  $('ncb').addEventListener('click', () => {
    const name = $('nc').value.trim();
    if (!name) return;
    if (data.cats[name] || isIncomeCategory(name)) return toast(t('cat.exists', { name }));
    $('nc').value = '';
    const color = $('ncc').value;
    $('ncc').value = nextCategoryColor({ ...data.cats, [name]: color });
    void update(() => repo.saveCategory(name, color));
  });

  function closeDeletePanel(): void {
    deleting = null;
    $('catDelete').hidden = true;
  }

  function openDeletePanel(name: string): void {
    deleting = name;
    const n = categoryUsage()[name] || 0;
    const others = expenseCategoryNames(data.cats).filter((c) => c !== name);
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
      if (data.cats[name] || isIncomeCategory(name)) return toast(t('cat.exists', { name }));
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
  $('xc').addEventListener('click', exporting(async () => download('expenses.csv', toCsv(await repo.listTransactions()), 'text/csv')));

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

  // ---- start ----

  setFormDate(ref);
  await load();
  // Categories used by old data but missing from the list get a colour.
  for (const [name, color] of Object.entries(missingCategories(data.txs, data.cats))) await repo.saveCategory(name, color);
  await refresh();
  return { refresh, notify: (m) => toast(m) };
}

export const importMessage = ({ transactions, skipped }: { transactions: number; skipped: number }): string =>
  tn('import.done', transactions) + (skipped ? t('import.skipped', { n: skipped }) : '');
