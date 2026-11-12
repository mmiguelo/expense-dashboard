import type { Snapshot, Transaction, TxType } from './types';

/** The name a transaction type has in the database and in CSV exports. */
export type TxTypeName = 'expense' | 'income' | 'savings';

export const txTypeName = (type: TxType): TxTypeName => (type === 'i' ? 'income' : type === 's' ? 'savings' : 'expense');
export const txTypeFromName = (name: string): TxType => (name === 'income' ? 'i' : name === 'savings' ? 's' : 'e');

export const CSV_HEADER = 'date,type,amount,category,subcategory,description,tags,fixed';

export function toCsv(transactions: Transaction[]): string {
  const rows = transactions.map((x) =>
    [
      x.date,
      txTypeName(x.type),
      x.amount,
      x.cat,
      '"' + String(x.sub || '').replace(/"/g, '""') + '"',
      '"' + String(x.desc).replace(/"/g, '""') + '"',
      '"' + (x.tags || '') + '"',
      x.fixed ? 1 : 0,
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
