// Field names are short because they match the persisted format (localStorage key `exp-v2`
// and JSON backups). Renaming them would break existing data.

/** 'e' = expense, 'i' = income. */
export type TxType = 'e' | 'i';

export interface Transaction {
  id: number;
  /** Local date, YYYY-MM-DD. */
  date: string;
  amount: number;
  desc: string;
  /** Category name; always 'Income' for income. */
  cat: string;
  type: TxType;
  tags?: string;
  /** Set on transactions generated from a recurring expense. */
  fixed?: 1;
}

export type NewTransaction = Omit<Transaction, 'id'>;

export interface RecurringExpense {
  id: string;
  desc: string;
  amount: number;
  cat: string;
  /** Day of month, 1-31. Clamped to the last day in shorter months. */
  day: number;
  /** First month to generate, YYYY-MM. */
  start: string;
}

/** Monthly budget per category name, in euros. */
export type Budgets = Record<string, number>;

/** Category name -> colour. Insertion order is display order. */
export type Categories = Record<string, string>;

/** Lower-cased description -> category the user picked for it. */
export type LearnedCategories = Record<string, string>;

/** Keys `${recurringId}${YYYY-MM}` of months already generated for a recurring expense. */
export type GeneratedMonths = Record<string, 1>;

export type Mode = 'day' | 'month' | 'year';

/** Everything the app stores, in the persisted/backup shape. */
export interface Snapshot {
  ex: Transaction[];
  rec: RecurringExpense[];
  bud: Budgets;
  cats: Categories;
  learn: LearnedCategories;
  gen: GeneratedMonths;
}
