import { DEFAULT_CATEGORIES } from '../categories';
import type { Budgets, Categories, GeneratedMonths, LearnedCategories, RecurringExpense, Snapshot, Transaction } from '../types';
import type { Repository } from './repository';

/** Current key: the whole Snapshot as JSON. */
export const STORAGE_KEY = 'exp-v2';
/** First version: a bare array of expenses. Read only if STORAGE_KEY is absent. */
export const LEGACY_STORAGE_KEY = 'expenses-v1';

const clone = <T>(v: T): T => structuredClone(v);

/**
 * Keeps the data in memory and writes the whole snapshot back after each change. If the
 * browser blocks storage the app keeps working for the session, as before.
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
      // Unreadable data: start from the defaults, as before.
    }
    return s;
  }

  private persist(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Quota exceeded or storage blocked: keep the in-memory data.
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

  async deleteTransaction(id: number): Promise<void> {
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

  async addGeneratedRecurring(transactions: Transaction[], keys: string[]): Promise<void> {
    if (!transactions.length && !keys.length) return;
    keys.forEach((k) => (this.state.gen[k] = 1));
    this.state.ex.push(...clone(transactions));
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

  async importSnapshot(data: Partial<Snapshot>): Promise<void> {
    this.state = { ...this.state, ...clone(data) };
    this.persist();
  }
}
