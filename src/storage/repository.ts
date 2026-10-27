import type { Budgets, Categories, GeneratedMonths, LearnedCategories, RecurringExpense, Snapshot, Transaction } from '../types';

/**
 * All reads and writes of app data go through this interface. Implementations must
 * return copies: callers may mutate what they get without affecting stored data.
 */
export interface Repository {
  listTransactions(): Promise<Transaction[]>;
  /** Insert, or replace the transaction with the same id (keeping its position). */
  saveTransaction(tx: Transaction): Promise<void>;
  deleteTransaction(id: number): Promise<void>;

  listRecurring(): Promise<RecurringExpense[]>;
  saveRecurring(rule: RecurringExpense): Promise<void>;
  deleteRecurring(id: string): Promise<void>;
  /** Months already generated per recurring expense. */
  getGeneratedMonths(): Promise<GeneratedMonths>;
  /** Store generated transactions and mark their months as done, together. */
  addGeneratedRecurring(transactions: Transaction[], keys: string[]): Promise<void>;

  getBudgets(): Promise<Budgets>;
  /** Set a category's monthly budget; null or 0 removes it. */
  setBudget(category: string, amount: number | null): Promise<void>;

  getCategories(): Promise<Categories>;
  saveCategory(name: string, color: string): Promise<void>;

  /** Category the user chose per lower-cased description. */
  getLearnedCategories(): Promise<LearnedCategories>;
  learnCategory(description: string, category: string): Promise<void>;

  /** Everything, in the backup format. */
  exportSnapshot(): Promise<Snapshot>;
  /** Replace the parts present in `data`; parts it leaves out are kept. */
  importSnapshot(data: Partial<Snapshot>): Promise<void>;
}
