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
import { guessCategory, INCOME_CATEGORY, missingCategories, nextCategoryColor } from '../categories';
import { shiftRef, toIsoDate } from '../dates';
import { amountToInput, parseAmount } from '../format';
import { generateRecurring } from '../recurring';
import type { Repository } from '../storage/repository';
import type { Budgets, Categories, GeneratedMonths, LearnedCategories, Mode, RecurringExpense, Transaction, TxType } from '../types';
import * as html from './render';

export interface AppOptions {
  doc: Document;
  repo: Repository;
  /** Current time; injectable for tests. */
  clock?: () => Date;
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
  learn: LearnedCategories;
  gen: GeneratedMonths;
}

export async function startApp({ doc, repo, clock = () => new Date() }: AppOptions): Promise<AppHandle> {
  const win = doc.defaultView!;
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => doc.getElementById(id) as T;
  const sel = (id: string) => $<HTMLSelectElement>(id);
  const today = () => toIsoDate(clock());
  const newId = () => crypto.randomUUID();

  let data: Data = { txs: [], rec: [], bud: {}, cats: {}, learn: {}, gen: {} };
  let mode: Mode = 'month';
  let ref = today();
  /** The user picked a category by hand, so stop auto-guessing it. */
  let touched = false;
  let editId: string | null = null;
  let lastDeleted: Transaction | null = null;
  let toastTimer: number | undefined;

  async function load(): Promise<void> {
    const [txs, rec, bud, cats, learn, gen] = await Promise.all([
      repo.listTransactions(),
      repo.listRecurring(),
      repo.getBudgets(),
      repo.getCategories(),
      repo.getLearnedCategories(),
      repo.getGeneratedMonths(),
    ]);
    data = { txs, rec, bud, cats, learn, gen };
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
    toast(`Couldn't save: ${(e as Error)?.message ?? e}. Check your connection and try again.`);
  }

  // ---- rendering ----

  function fillSelects(): void {
    const selects = [sel('cat'), sel('fc'), sel('rc')];
    const values = selects.map((s) => s.value);
    selects[0]!.innerHTML = html.categoryOptions(data.cats);
    selects[1]!.innerHTML = html.categoryOptions(data.cats, true, true);
    selects[2]!.innerHTML = html.categoryOptions(data.cats);
    selects.forEach((s, i) => {
      if (values[i]) s.value = values[i]!;
    });
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
    ['amt', 'desc', 'tags'].forEach((i) => ($(i).value = ''));
    sel('type').value = 'e';
    $('date').value = ref;
    sel('cat').disabled = false;
    $('sub').textContent = 'Add';
    $('cancel').hidden = true;
    $('fT').textContent = 'Add a transaction';
  }

  async function submitTransaction(): Promise<void> {
    const amount = parseAmount($('amt').value);
    if (!(amount > 0) || !$('date').value) return;
    const type = sel('type').value as TxType;
    const desc = $('desc').value.trim();
    const cat = type === 'i' ? INCOME_CATEGORY : sel('cat').value;
    const fields = { date: $('date').value, amount, desc: desc || cat, cat, type, tags: $('tags').value.trim() };
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
    $('date').value = x.date;
    $('amt').value = amountToInput(x.amount);
    $('desc').value = x.desc;
    $('tags').value = x.tags || '';
    sel('cat').disabled = x.type === 'i';
    if (x.type === 'e') sel('cat').value = x.cat;
    touched = false;
    $('sub').textContent = 'Save changes';
    $('cancel').hidden = false;
    $('fT').textContent = 'Edit transaction';
    $('f').scrollIntoView({ behavior: 'smooth' });
  }

  $('desc').addEventListener('input', () => {
    const g = guessCategory($('desc').value, data.learn, data.cats);
    if (g && !touched && sel('type').value === 'e') sel('cat').value = g;
  });
  sel('cat').addEventListener('change', () => (touched = true));
  sel('type').addEventListener('change', () => (sel('cat').disabled = sel('type').value === 'i'));
  $('cancel').addEventListener('click', resetForm);
  $('sub').addEventListener('click', () => void submitTransaction());
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
          toast('Transaction deleted', true);
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
      sel('cat').value = c.cat;
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
      day: +$('rday').value || 1,
      start: today().slice(0, 7),
    };
    ['rd', 'ra'].forEach((i) => ($(i).value = ''));
    void update(() => repo.saveRecurring(rule));
  });

  $('ncb').addEventListener('click', () => {
    const name = $('nc').value.trim();
    if (!name || data.cats[name]) return;
    $('nc').value = '';
    void update(() => repo.saveCategory(name, nextCategoryColor(data.cats)));
  });

  function download(name: string, text: string, type: string): void {
    const a = doc.createElement('a');
    a.href = win.URL.createObjectURL(new win.Blob([text], { type }));
    a.download = name;
    a.click();
  }

  const exporting = (run: () => Promise<void>) => () =>
    run().catch((e) => toast(`Couldn't export: ${(e as Error)?.message ?? e}`));
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
    if (!backup) win.alert('This file is not a valid backup.');
    return backup;
  }

  $('imp').addEventListener('change', async (e) => {
    const backup = await pickedBackup(e);
    if (!backup || !win.confirm('Replace current data with this backup?')) return;
    await update(
      () => repo.importSnapshot(backup, { replace: true }),
      async () => {
        await render();
        toast('Backup imported');
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

  $('date').value = ref;
  await load();
  // Categories used by old data but missing from the list get a colour.
  for (const [name, color] of Object.entries(missingCategories(data.txs, data.cats))) await repo.saveCategory(name, color);
  await refresh();
  return { refresh, notify: (m) => toast(m) };
}

export const importMessage = ({ transactions, skipped }: { transactions: number; skipped: number }): string =>
  `Imported ${transactions} transaction${transactions === 1 ? '' : 's'}` + (skipped ? ` (${skipped} already there, skipped)` : '');
