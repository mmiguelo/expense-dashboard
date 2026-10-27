import { DEFAULT_CATEGORIES } from '../categories';
import { generatedKey } from '../recurring';
import type {
  Budgets,
  Categories,
  GeneratedMonths,
  LearnedCategories,
  RecurringExpense,
  RecurringOccurrence,
  Snapshot,
  Transaction,
} from '../types';
import type { ImportResult, Repository } from './repository';

// Data saved in this browser before accounts existed. Signed-in users keep their data in
// Supabase; this is only read to offer a one-time import into the account.

/** Current key: the whole Snapshot as JSON. */
export const STORAGE_KEY = 'exp-v2';
/** First version: a bare array of expenses. Read only if STORAGE_KEY is absent. */
export const LEGACY_STORAGE_KEY = 'expenses-v1';
/** Users (ids) who imported this browser's data into their account. */
const IMPORTED_KEY = 'exp-imported-by';

const clone = <T>(v: T): T => structuredClone(v);

/** Read old data with numeric ids into the current shape. */
const normalize = (s: Snapshot): Snapshot => ({ ...s, ex: s.ex.map((x) => ({ ...x, id: String(x.id) })) });

/**
 * Keeps the data in memory and writes the whole snapshot back after each change. If the
 * browser blocks storage it keeps working for the session.
 */
export class LocalStorageRepository implements Repository {
  private state: Snapshot;

  constructor(private readonly storage: Storage = window.localStorage) {
    this.state = this.load();
  }

  private load(): Snapshot {
    let s: Snapshot = { ex: [], rec: [], bud: {}, cats: { ...DEFAULT_CATEGORIES }, learn: {}, gen: {} };
    try {
      const current = this.storage.getItem(STORAGE_KEY);
      const legacy = this.storage.getItem(LEGACY_STORAGE_KEY);
      if (current) s = { ...s, ...JSON.parse(current) };
      else if (legacy) s.ex = JSON.parse(legacy).map((x: Omit<Transaction, 'type'>) => ({ ...x, type: 'e' }));
    } catch {
      // Unreadable data: start from the defaults.
    }
    return normalize(s);
  }

  private persist(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Quota exceeded or storage blocked: keep the in-memory data.
    }
  }

  /** Whether this browser has any transactions or recurring expenses saved. */
  hasData(): boolean {
    return this.state.ex.length > 0 || this.state.rec.length > 0;
  }

  /** Whether `userId` already imported this browser's data. */
  wasImportedBy(userId: string): boolean {
    return this.importedBy().includes(userId);
  }

  markImportedBy(userId: string): void {
    try {
      this.storage.setItem(IMPORTED_KEY, JSON.stringify([...new Set([...this.importedBy(), userId])]));
    } catch {
      // Storage blocked: the import banner just shows again; importing again adds nothing.
    }
  }

  private importedBy(): string[] {
    try {
      return JSON.parse(this.storage.getItem(IMPORTED_KEY) || '[]');
    } catch {
      return [];
    }
  }

  async listTransactions(): Promise<Transaction[]> {
    return clone(this.state.ex);
  }

  async saveTransaction(tx: Transaction): Promise<void> {
    const i = this.state.ex.findIndex((x) => x.id === tx.id);
    if (i >= 0) this.state.ex[i] = clone(tx);
    else this.state.ex.push(clone(tx));
    this.persist();
  }

  async deleteTransaction(id: string): Promise<void> {
    this.state.ex = this.state.ex.filter((x) => x.id !== id);
    this.persist();
  }

  async listRecurring(): Promise<RecurringExpense[]> {
    return clone(this.state.rec);
  }

  async saveRecurring(rule: RecurringExpense): Promise<void> {
    const i = this.state.rec.findIndex((r) => r.id === rule.id);
    if (i >= 0) this.state.rec[i] = clone(rule);
    else this.state.rec.push(clone(rule));
    this.persist();
  }

  async deleteRecurring(id: string): Promise<void> {
    this.state.rec = this.state.rec.filter((r) => r.id !== id);
    this.persist();
  }

  async getGeneratedMonths(): Promise<GeneratedMonths> {
    return clone(this.state.gen);
  }

  async addGeneratedRecurring(occurrences: RecurringOccurrence[]): Promise<void> {
    const fresh = occurrences.filter((o) => !this.state.gen[generatedKey(o.recurringId, o.month)]);
    if (!fresh.length) return;
    for (const o of fresh) {
      this.state.gen[generatedKey(o.recurringId, o.month)] = 1;
      this.state.ex.push(clone(o.transaction));
    }
    this.persist();
  }

  async getBudgets(): Promise<Budgets> {
    return clone(this.state.bud);
  }

  async setBudget(category: string, amount: number | null): Promise<void> {
    if (amount && amount > 0) this.state.bud[category] = amount;
    else delete this.state.bud[category];
    this.persist();
  }

  async getCategories(): Promise<Categories> {
    return clone(this.state.cats);
  }

  async saveCategory(name: string, color: string): Promise<void> {
    this.state.cats[name] = color;
    this.persist();
  }

  async getLearnedCategories(): Promise<LearnedCategories> {
    return clone(this.state.learn);
  }

  async learnCategory(description: string, category: string): Promise<void> {
    this.state.learn[description.toLowerCase()] = category;
    this.persist();
  }

  async exportSnapshot(): Promise<Snapshot> {
    return clone(this.state);
  }

  async importSnapshot(data: Partial<Snapshot>, { replace }: { replace: boolean }): Promise<ImportResult> {
    const incoming = clone(data);
    const txs = (incoming.ex ?? []).map((x) => ({ ...x, id: String(x.id) }));
    if (replace) {
      this.state = { ...this.state, ...incoming, ...(incoming.ex ? { ex: txs } : {}) };
      this.persist();
      return { transactions: txs.length, skipped: 0 };
    }
    const s = this.state;
    const known = new Set(s.ex.map((x) => x.id));
    const added = txs.filter((x) => !known.has(x.id) && known.add(x.id));
    s.ex.push(...added);
    const rules = new Set(s.rec.map((r) => r.id));
    s.rec.push(...(incoming.rec ?? []).filter((r) => !rules.has(r.id) && rules.add(r.id)));
    s.bud = { ...incoming.bud, ...s.bud };
    s.cats = { ...s.cats, ...incoming.cats, ...s.cats };
    s.learn = { ...incoming.learn, ...s.learn };
    s.gen = { ...s.gen, ...incoming.gen };
    this.persist();
    return { transactions: added.length, skipped: txs.length - added.length };
  }
}
