import type { SupabaseClient } from '@supabase/supabase-js';
import { INCOME_CATEGORY, normalizeKeyword } from '../categories';
import { t } from '../i18n';
import { generatedKey, parseGeneratedKey } from '../recurring';
import type {
  Budgets,
  Categories,
  GeneratedMonths,
  KeywordRule,
  LearnedCategories,
  Profile,
  RecurringExpense,
  RecurringOccurrence,
  Snapshot,
  Subcategories,
  Transaction,
} from '../types';
import type { ImportResult, Repository } from './repository';

// Rows as stored in Postgres (see supabase/migrations). user_id is never sent: it
// defaults to auth.uid(), and Row Level Security limits every query to the signed-in
// user's rows.

export interface TransactionRow {
  id: string;
  date: string;
  amount: number;
  type: 'expense' | 'income';
  category: string;
  subcategory: string;
  description: string;
  tags: string;
  fixed: boolean;
}

export interface RecurringRow {
  id: string;
  description: string;
  amount: number;
  category: string;
  subcategory: string;
  day: number;
  /** YYYY-MM-01 */
  start_month: string;
}

/** PostgREST returns at most this many rows per request. */
const PAGE = 1000;
const FALLBACK_COLOR = '#a39b8b';
const MAX_TEXT = 500;

export const txFromRow = (r: TransactionRow): Transaction => ({
  id: r.id,
  date: r.date,
  amount: Number(r.amount),
  desc: r.description,
  cat: r.category,
  ...(r.subcategory ? { sub: r.subcategory } : {}),
  type: r.type === 'income' ? 'i' : 'e',
  tags: r.tags,
  ...(r.fixed ? { fixed: 1 as const } : {}),
});

export const txToRow = (x: Transaction): TransactionRow => ({
  id: x.id,
  date: x.date,
  amount: x.amount,
  type: x.type === 'i' ? 'income' : 'expense',
  category: x.cat,
  subcategory: x.sub || '',
  description: x.desc,
  tags: x.tags || '',
  fixed: !!x.fixed,
});

export interface ProfileRow {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'member';
  active: boolean;
  owner: boolean;
  created_at: string;
}

export const profileFromRow = (r: ProfileRow): Profile => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  role: r.role,
  active: r.active,
  owner: r.owner ?? false,
  createdAt: r.created_at,
});

export const ruleFromRow = (r: RecurringRow): RecurringExpense => ({
  id: r.id,
  desc: r.description,
  amount: Number(r.amount),
  cat: r.category,
  ...(r.subcategory ? { sub: r.subcategory } : {}),
  day: r.day,
  start: r.start_month.slice(0, 7),
});

export const ruleToRow = (r: RecurringExpense): RecurringRow => ({
  id: r.id,
  description: r.desc,
  amount: r.amount,
  category: r.cat,
  subcategory: r.sub || '',
  day: r.day,
  start_month: `${r.start}-01`,
});

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s);
const isAmount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const text = (s: unknown, max = MAX_TEXT) => String(s ?? '').slice(0, max);
const color = (c: unknown) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : FALLBACK_COLOR);

export interface ImportPayload {
  categories?: { name: string; color: string }[];
  subcategories?: { category: string; name: string }[];
  budgets?: { category: string; amount: number }[];
  corrections?: { merchant: string; category: string }[];
  keyword_rules?: { keyword: string; category: string }[];
  recurring?: { source_id: string; description: string; amount: number; category: string; subcategory: string; day: number; start_month: string }[];
  occurrences?: { recurring_source_id: string; month: string }[];
  transactions?: (Omit<TransactionRow, 'id'> & { source_id: string })[];
}

/**
 * Convert a backup (localStorage data or a JSON file) into the payload of the
 * import_snapshot database function. Only parts present in the backup are included,
 * and rows the database would reject (no amount, invalid date, ...) are left out.
 */
export function toImportPayload(data: Partial<Snapshot>): ImportPayload {
  const p: ImportPayload = {};
  if (data.cats)
    p.categories = Object.entries(data.cats)
      .filter(([name]) => name.trim())
      .map(([name, c]) => ({ name: text(name, 100), color: color(c) }));
  if (data.subs)
    p.subcategories = Object.entries(data.subs).flatMap(([category, names]) =>
      (Array.isArray(names) ? names : [])
        .filter((n) => typeof n === 'string' && n.trim())
        .map((n) => ({ category: text(category, 100), name: text(n, 100) })),
    );
  if (data.bud)
    p.budgets = Object.entries(data.bud)
      .filter(([category, amount]) => category && isAmount(amount))
      .map(([category, amount]) => ({ category: text(category, 100), amount }));
  if (data.learn)
    p.corrections = Object.entries(data.learn)
      .filter(([merchant, category]) => merchant.trim() && category)
      .map(([merchant, category]) => ({ merchant: text(merchant.toLowerCase()), category }));
  if (data.rules)
    p.keyword_rules = data.rules
      .filter((r) => r && r.keyword && r.category)
      .map((r) => ({ keyword: text(normalizeKeyword(r.keyword), 100), category: text(r.category, 100) }));
  if (data.rec)
    p.recurring = data.rec
      .filter((r) => r && isAmount(r.amount) && isMonth(r.start) && text(r.desc).trim() && r.day >= 1 && r.day <= 31)
      .map((r) => ({
        source_id: String(r.id),
        description: text(r.desc),
        amount: r.amount,
        category: text(r.cat, 100),
        subcategory: text(r.sub, 100),
        day: Math.trunc(r.day),
        start_month: `${r.start}-01`,
      }));
  if (data.gen)
    p.occurrences = Object.keys(data.gen)
      .map(parseGeneratedKey)
      .filter((k) => k.recurringId && isMonth(k.month))
      .map((k) => ({ recurring_source_id: k.recurringId, month: `${k.month}-01` }));
  if (data.ex)
    p.transactions = data.ex
      .filter((x) => x && isDate(x.date) && isAmount(x.amount) && x.cat)
      .map((x) => ({
        source_id: String(x.id),
        date: x.date,
        amount: x.amount,
        type: x.type === 'i' ? 'income' : 'expense',
        // Income is always in 'Rendimentos' (old backups say 'Income').
        category: x.type === 'i' ? INCOME_CATEGORY : text(x.cat, 100),
        subcategory: text(x.sub, 100),
        description: text(x.desc),
        tags: text(x.tags),
        fixed: !!x.fixed,
      }));
  return p;
}

export class SupabaseRepository implements Repository {
  /** `userId`: the signed-in user. New accounts get their categories from the database. */
  constructor(
    private readonly db: SupabaseClient,
    private readonly userId: string,
  ) {}

  async getProfile(): Promise<Profile> {
    const { data, error } = await this.db
      .from('profiles')
      .select('id, email, display_name, role, active, owner, created_at')
      .eq('id', this.userId)
      .single();
    if (error) throw toError(error);
    return profileFromRow(data);
  }

  async updateDisplayName(name: string): Promise<void> {
    const { data, error } = await this.db.from('profiles').update({ display_name: name }).eq('id', this.userId).select('id');
    if (error) throw toError(error);
    if (!data?.length) throw new Error(t('admin.err.notAllowed'));
  }

  /** Every row of a query, fetched a page at a time. */
  private async all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await page(from, from + PAGE - 1);
      if (error) throw toError(error);
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) return out;
    }
  }

  async listTransactions(): Promise<Transaction[]> {
    const rows = await this.all<TransactionRow>((from, to) =>
      this.db.from('transactions').select('id, date, amount, type, category, subcategory, description, tags, fixed').order('seq').range(from, to),
    );
    return rows.map(txFromRow);
  }

  async saveTransaction(tx: Transaction): Promise<void> {
    check(await this.db.from('transactions').upsert(txToRow(tx)));
  }

  async deleteTransaction(id: string): Promise<void> {
    check(await this.db.from('transactions').delete().eq('id', id));
  }

  async listRecurring(): Promise<RecurringExpense[]> {
    const rows = await this.all<RecurringRow>((from, to) =>
      this.db.from('recurring_expenses').select('id, description, amount, category, subcategory, day, start_month').order('seq').range(from, to),
    );
    return rows.map(ruleFromRow);
  }

  async saveRecurring(rule: RecurringExpense): Promise<void> {
    check(await this.db.from('recurring_expenses').upsert(ruleToRow(rule)));
  }

  async deleteRecurring(id: string): Promise<void> {
    check(await this.db.from('recurring_expenses').delete().eq('id', id));
  }

  async getGeneratedMonths(): Promise<GeneratedMonths> {
    const rows = await this.all<{ recurring_id: string; month: string }>((from, to) =>
      this.db.from('recurring_occurrences').select('recurring_id, month').order('recurring_id').order('month').range(from, to),
    );
    return Object.fromEntries(rows.map((r) => [generatedKey(r.recurring_id, r.month.slice(0, 7)), 1 as const]));
  }

  async addGeneratedRecurring(occurrences: RecurringOccurrence[]): Promise<void> {
    if (!occurrences.length) return;
    const items = occurrences.map(({ recurringId, month, transaction: t }) => ({
      recurring_id: recurringId,
      month: `${month}-01`,
      id: t.id,
      date: t.date,
      amount: t.amount,
      category: t.cat,
      subcategory: t.sub || '',
      description: t.desc,
    }));
    check(await this.db.rpc('add_recurring_occurrences', { items }));
  }

  async getBudgets(): Promise<Budgets> {
    const { data, error } = await this.db.from('budgets').select('category, amount');
    if (error) throw toError(error);
    return Object.fromEntries((data ?? []).map((r) => [r.category, Number(r.amount)]));
  }

  async setBudget(category: string, amount: number | null): Promise<void> {
    if (amount && amount > 0) check(await this.db.from('budgets').upsert({ category, amount }, { onConflict: 'user_id,category' }));
    else check(await this.db.from('budgets').delete().eq('category', category));
  }

  async getCategories(): Promise<Categories> {
    const { data, error } = await this.db.from('categories').select('name, color').order('id');
    if (error) throw toError(error);
    return Object.fromEntries((data ?? []).map((r) => [r.name, r.color]));
  }

  async saveCategory(name: string, color: string): Promise<void> {
    check(await this.db.from('categories').upsert({ name, color }, { onConflict: 'user_id,name' }));
  }

  async renameCategory(oldName: string, newName: string): Promise<void> {
    check(await this.db.rpc('rename_category', { old_name: oldName, new_name: newName }));
  }

  async deleteCategory(name: string, reassignTo: string | null): Promise<void> {
    check(await this.db.rpc('delete_category', { category_name: name, reassign_to: reassignTo }));
  }

  async getSubcategories(): Promise<Subcategories> {
    const rows = await this.all<{ category: string; name: string }>((from, to) =>
      this.db.from('subcategories').select('category, name').order('id').range(from, to),
    );
    const out: Subcategories = {};
    for (const r of rows) (out[r.category] ??= []).push(r.name);
    return out;
  }

  async addSubcategory(category: string, name: string): Promise<void> {
    check(await this.db.from('subcategories').insert({ category, name }));
  }

  async deleteSubcategory(category: string, name: string): Promise<void> {
    check(await this.db.rpc('delete_subcategory', { category_name: category, subcategory_name: name }));
  }

  async listKeywordRules(): Promise<KeywordRule[]> {
    const rows = await this.all<{ id: number; keyword: string; category: string }>((from, to) =>
      this.db.from('keyword_rules').select('id, keyword, category').order('id').range(from, to),
    );
    return rows.map((r) => ({ id: Number(r.id), keyword: r.keyword, category: r.category }));
  }

  async saveKeywordRule({ id, keyword, category }: KeywordRule): Promise<void> {
    const row = { keyword: normalizeKeyword(keyword), category };
    if (id === undefined) check(await this.db.from('keyword_rules').insert(row));
    else check(await this.db.from('keyword_rules').update(row).eq('id', id));
  }

  async deleteKeywordRule(id: number): Promise<void> {
    check(await this.db.from('keyword_rules').delete().eq('id', id));
  }

  async getLearnedCategories(): Promise<LearnedCategories> {
    const rows = await this.all<{ merchant: string; category: string }>((from, to) =>
      this.db.from('category_corrections').select('merchant, category').order('merchant').range(from, to),
    );
    return Object.fromEntries(rows.map((r) => [r.merchant, r.category]));
  }

  async learnCategory(description: string, category: string): Promise<void> {
    check(
      await this.db
        .from('category_corrections')
        .upsert({ merchant: description.toLowerCase(), category, updated_at: new Date().toISOString() }, { onConflict: 'user_id,merchant' }),
    );
  }

  async exportSnapshot(): Promise<Snapshot> {
    const [ex, rec, bud, cats, subs, learn, gen, rules] = await Promise.all([
      this.listTransactions(),
      this.listRecurring(),
      this.getBudgets(),
      this.getCategories(),
      this.getSubcategories(),
      this.getLearnedCategories(),
      this.getGeneratedMonths(),
      this.listKeywordRules(),
    ]);
    return { ex, rec, bud, cats, subs, learn, gen, rules: rules.map(({ keyword, category }) => ({ keyword, category })) };
  }

  async importSnapshot(data: Partial<Snapshot>, { replace }: { replace: boolean }): Promise<ImportResult> {
    const payload = toImportPayload(data);
    const { data: counts, error } = await this.db.rpc('import_snapshot', { payload, replace_existing: replace });
    if (error) throw toError(error);
    const total = data.ex?.length ?? 0;
    return { transactions: counts.transactions, skipped: total - counts.transactions };
  }
}

/** Throw database errors as Error, with the database's message. */
function check({ error }: { error: unknown }): void {
  if (error) throw toError(error);
}

export const toError = (e: unknown): Error =>
  e instanceof Error ? e : Object.assign(new Error((e as { message?: string })?.message ?? String(e)), { cause: e });
