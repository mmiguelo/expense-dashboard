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
  Transaction,
} from '../types';

export interface ImportResult {
  /** Transactions added. */
  transactions: number;
  /** Transactions left out because they were already there. */
  skipped: number;
}

/**
 * All reads and writes of the signed-in user's own data go through this interface.
 * Implementations must return copies: callers may mutate what they get.
 */
export interface Repository {
  /** The signed-in user's account: email, role, whether it is active. */
  getProfile(): Promise<Profile>;

  /** In the order they were added. */
  listTransactions(): Promise<Transaction[]>;
  /** Insert, or replace the transaction with the same id. */
  saveTransaction(tx: Transaction): Promise<void>;
  deleteTransaction(id: string): Promise<void>;

  listRecurring(): Promise<RecurringExpense[]>;
  saveRecurring(rule: RecurringExpense): Promise<void>;
  deleteRecurring(id: string): Promise<void>;
  /** Months already generated per recurring expense. */
  getGeneratedMonths(): Promise<GeneratedMonths>;
  /**
   * Store generated transactions and mark their months as done, together. Months that
   * are already marked (e.g. by another device) are skipped, so this is safe to repeat.
   */
  addGeneratedRecurring(occurrences: RecurringOccurrence[]): Promise<void>;

  getBudgets(): Promise<Budgets>;
  /** Set a category's monthly budget; null or 0 removes it. */
  setBudget(category: string, amount: number | null): Promise<void>;

  /** In display order. */
  getCategories(): Promise<Categories>;
  /** Add a category, or change its colour. */
  saveCategory(name: string, color: string): Promise<void>;
  /** Rename, updating its transactions, recurring expenses, rules and budget. */
  renameCategory(oldName: string, newName: string): Promise<void>;
  /**
   * Delete, moving its transactions, recurring expenses and rules to `reassignTo`.
   * Fails if it is in use and `reassignTo` is null. Its budget is deleted.
   */
  deleteCategory(name: string, reassignTo: string | null): Promise<void>;

  /** In matching order. */
  listKeywordRules(): Promise<KeywordRule[]>;
  /** Add (no id) or change a rule. */
  saveKeywordRule(rule: KeywordRule): Promise<void>;
  deleteKeywordRule(id: number): Promise<void>;

  /** Category the user chose per lower-cased description. */
  getLearnedCategories(): Promise<LearnedCategories>;
  learnCategory(description: string, category: string): Promise<void>;

  /** Everything, in the backup format. */
  exportSnapshot(): Promise<Snapshot>;
  /**
   * Bring in a backup. With `replace`, the parts present in `data` replace the current
   * ones. Otherwise it is merged: anything already there (same transaction or recurring
   * id, same category name) is kept and the duplicate skipped, so repeating an import
   * adds nothing.
   */
  importSnapshot(data: Partial<Snapshot>, options: { replace: boolean }): Promise<ImportResult>;
}
