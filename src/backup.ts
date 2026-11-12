import type { Account, Snapshot, Transaction, TxType } from './types';

/** The name a transaction type has in the database and in CSV exports. */
export type TxTypeName = 'expense' | 'income' | 'transfer' | 'adjustment';

const TYPE_NAMES: Record<TxType, TxTypeName> = { e: 'expense', i: 'income', t: 'transfer', a: 'adjustment' };

export const txTypeName = (type: TxType): TxTypeName => TYPE_NAMES[type];
export const txTypeFromName = (name: string): TxType =>
  (Object.keys(TYPE_NAMES) as TxType[]).find((k) => TYPE_NAMES[k] === name) ?? 'e';

export const CSV_HEADER = 'date,type,amount,account,to_account,category,subcategory,description,tags,fixed,reimbursable';

const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"';

/** Soft-deleted transactions are left out. */
export function toCsv(transactions: Transaction[], accounts: Account[] = []): string {
  const name = (id?: string) => quote(accounts.find((a) => a.id === id)?.name ?? '');
  const rows = transactions.filter((x) => !x.del).map((x) =>
    [
      x.date,
      txTypeName(x.type),
      x.amount,
      name(x.acc),
      name(x.to),
      x.cat,
      '"' + String(x.sub || '').replace(/"/g, '""') + '"',
      '"' + String(x.desc).replace(/"/g, '""') + '"',
      '"' + (x.tags || '') + '"',
      x.fixed ? 1 : 0,
      x.reimb ? 1 : 0,
    ].join(','),
  );
  return CSV_HEADER + '\n' + rows.join('\n');
}

/**
 * Parse a JSON backup. Returns null if it isn't one. Keys missing from the backup are
 * left out, so importing keeps the current values for them.
 */
export function parseBackup(text: string): Partial<Snapshot> | null {
  try {
    const o = JSON.parse(text);
    return Array.isArray(o?.ex) ? o : null;
  } catch {
    return null;
  }
}
