// Field names are short because they match the persisted format (browser storage key `exp-v2`
// and JSON backups). Renaming them would break existing data.

/**
 * 'e' = expense (a negative amount is money back: a refund or reimbursement), 'i' = income,
 * 't' = transfer between two of the user's accounts, 'a' = balance adjustment (signed).
 * Transfers and adjustments are never income or spending.
 */
export type TxType = 'e' | 'i' | 't' | 'a';

export interface Transaction {
  /** UUID. Data from before accounts has numeric ids, read as strings. */
  id: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  amount: number;
  desc: string;
  /** Category name; always 'Rendimentos' for income ('Income' in old data); '' for transfers and adjustments. */
  cat: string;
  /** One of the category's subcategories; absent or '' = none. */
  sub?: string;
  type: TxType;
  tags?: string;
  /** Set on transactions generated from a recurring expense. */
  fixed?: 1;
  /** Account id. Absent only in old backups, which go to the first account. */
  acc?: string;
  /** Transfers: the receiving account. */
  to?: string;
  /** Transfers: the amount that arrived (same as `amount` until accounts have currencies). */
  toAmt?: number;
  /** A purchase someone else will pay back. */
  reimb?: 1;
  /** Soft-deleted (ISO timestamp). */
  del?: string;
}

export type NewTransaction = Omit<Transaction, 'id'>;

export interface RecurringExpense {
  id: string;
  desc: string;
  amount: number;
  cat: string;
  sub?: string;
  /** Day of month, 1-31. Clamped to the last day in shorter months. */
  day: number;
  /** First month to generate, YYYY-MM. */
  start: string;
}

/** Monthly budget per category name, in euros. */
export type Budgets = Record<string, number>;

/** Category name -> colour. Insertion order is display order. */
export type Categories = Record<string, string>;

/** Category name -> its subcategories, in display order. */
export type Subcategories = Record<string, string[]>;

/** Lower-cased description -> category the user picked for it. */
export type LearnedCategories = Record<string, string>;

/** Keys `${recurringId}${YYYY-MM}` of months already generated for a recurring expense. */
export type GeneratedMonths = Record<string, 1>;

/** A month of a recurring expense and the transaction generated for it. */
export interface RecurringOccurrence {
  recurringId: string;
  /** YYYY-MM */
  month: string;
  transaction: Transaction;
}

export type Mode = 'day' | 'month' | 'year';

/**
 * A description containing `keyword` (lower case, matched against the lower-cased
 * description padded with spaces) is guessed as `category`. The first matching rule wins.
 */
export interface KeywordRule {
  /** Absent for a rule not saved yet. */
  id?: number;
  keyword: string;
  category: string;
}

/**
 * Where money is. The kind decides behaviour through generic rules only: checking counts
 * as available to spend; savings, restricted (meal card, benefits wallet) and credit don't;
 * a credit balance is normally negative (a debt).
 */
export type AccountKind = 'checking' | 'savings' | 'restricted' | 'credit';

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** ISO 4217 code. Always the profile's currency until accounts can have their own. */
  currency: string;
  /** Balance on `openingDate`, before that day's transactions. */
  openingBalance: number;
  /** YYYY-MM-DD. Transactions before this date don't change the balance. */
  openingDate: string;
  /** A label only, e.g. the bank's name; never used in logic. */
  institution: string;
  /** Closed but part of history: hidden from the form, still in reports. */
  archived: boolean;
  /** Soft-deleted (ISO timestamp): left out of everything until restored. */
  deletedAt?: string;
}

export type Role = 'admin' | 'member';

export interface Profile {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  /** The protected admin: nobody can demote, deactivate or delete it. */
  owner: boolean;
  createdAt: string;
  /** ISO 4217 code totals are shown in. */
  currency: string;
}

/** Everything the app stores, in the backup shape. */
export interface Snapshot {
  ex: Transaction[];
  rec: RecurringExpense[];
  bud: Budgets;
  cats: Categories;
  /** Absent in backups from before subcategories. */
  subs?: Subcategories;
  learn: LearnedCategories;
  gen: GeneratedMonths;
  /** Keyword rules; absent in backups from before accounts had their own. */
  rules?: KeywordRule[];
  /** Money accounts; absent in backups from before them. */
  accounts?: Account[];
}
