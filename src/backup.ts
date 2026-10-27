import type { Snapshot, Transaction } from './types';

export const CSV_HEADER = 'date,type,amount,category,description,tags,fixed';

export function toCsv(transactions: Transaction[]): string {
  const rows = transactions.map((x) =>
    [
      x.date,
      x.type === 'i' ? 'income' : 'expense',
      x.amount,
      x.cat,
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
