import { missingCategories } from '../categories';
import type { Snapshot, Transaction } from '../types';

// Data saved in this browser before accounts existed. It is only read, to offer a
// one-time import into the signed-in account; it is never changed or deleted.

/** Current key: the whole Snapshot as JSON. */
export const STORAGE_KEY = 'exp-v2';
/** First version: a bare array of expenses. Read only if STORAGE_KEY is absent. */
export const LEGACY_STORAGE_KEY = 'expenses-v1';
/** Users (ids) who imported this browser's data into their account. */
const IMPORTED_KEY = 'exp-imported-by';

export class LegacyLocalStore {
  private readonly data: Snapshot;

  constructor(private readonly storage: Storage = window.localStorage) {
    this.data = this.load();
  }

  private load(): Snapshot {
    let s: Snapshot = { ex: [], rec: [], bud: {}, cats: {}, learn: {}, gen: {} };
    try {
      const current = this.storage.getItem(STORAGE_KEY);
      const legacy = this.storage.getItem(LEGACY_STORAGE_KEY);
      if (current) s = { ...s, ...JSON.parse(current) };
      else if (legacy) s.ex = JSON.parse(legacy).map((x: Omit<Transaction, 'type'>) => ({ ...x, type: 'e' }));
    } catch {
      // Unreadable data: nothing to import.
    }
    const ex = (Array.isArray(s.ex) ? s.ex : []).map((x) => ({ ...x, id: String(x.id) }));
    // Old data could use categories it didn't list (e.g. expenses-v1 had no list at all).
    return { ...s, ex, cats: { ...s.cats, ...missingCategories(ex, s.cats ?? {}) } };
  }

  /** Whether this browser has any transactions or recurring expenses saved. */
  hasData(): boolean {
    return this.data.ex.length > 0 || (this.data.rec?.length ?? 0) > 0;
  }

  get transactionCount(): number {
    return this.data.ex.length;
  }

  /** Everything, in the backup format, ready for Repository.importSnapshot. */
  snapshot(): Snapshot {
    return structuredClone(this.data);
  }

  /** Whether `userId` already imported this browser's data. */
  wasImportedBy(userId: string): boolean {
    return this.importedBy().includes(userId);
  }

  markImportedBy(userId: string): void {
    try {
      this.storage.setItem(IMPORTED_KEY, JSON.stringify([...new Set([...this.importedBy(), userId])]));
    } catch {
      // Storage blocked: the import offer just shows again; importing again adds nothing.
    }
  }

  private importedBy(): string[] {
    try {
      return JSON.parse(this.storage.getItem(IMPORTED_KEY) || '[]');
    } catch {
      return [];
    }
  }
}
