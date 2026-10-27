import type { Profile, Role } from '../types';

export interface DefaultCategory {
  /** Absent for one not saved yet. */
  id?: number;
  name: string;
  color: string;
  sortOrder: number;
}

export interface DefaultKeywordRule {
  id?: number;
  category: string;
  keyword: string;
}

/**
 * What the Admin screen can do: manage accounts and the defaults new accounts start
 * with. The database only allows it for active admins, and gives no access to anyone's
 * financial data.
 */
export interface AdminRepository {
  listProfiles(): Promise<Profile[]>;
  /** Change another account. Changing your own role or activation is refused. */
  updateProfile(id: string, changes: Partial<Pick<Profile, 'role' | 'active' | 'displayName'>>): Promise<void>;

  listDefaultCategories(): Promise<DefaultCategory[]>;
  /** Add (no id) or change; renaming also renames its default keyword rules. */
  saveDefaultCategory(category: DefaultCategory): Promise<void>;
  /** Also deletes its default keyword rules. Existing accounts are not affected. */
  deleteDefaultCategory(id: number): Promise<void>;

  listDefaultKeywordRules(): Promise<DefaultKeywordRule[]>;
  saveDefaultKeywordRule(rule: DefaultKeywordRule): Promise<void>;
  deleteDefaultKeywordRule(id: number): Promise<void>;
}

export const ROLES: Role[] = ['member', 'admin'];
