import type { CategoryKind, Profile, Role } from '../types';

export interface DefaultCategory {
  /** Absent for one not saved yet. */
  id?: number;
  name: string;
  color: string;
  sortOrder: number;
  /** Set when the category is added; fixed after that. Absent means expense. */
  kind?: CategoryKind;
}

/** An item on the admins' to-do list for the app. */
export interface RoadmapItem {
  /** Absent for one not saved yet. */
  id?: number;
  text: string;
  done: boolean;
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

  /** The admins' to-do list, oldest first. */
  listRoadmap(): Promise<RoadmapItem[]>;
  /** Add (no id) or change. */
  saveRoadmapItem(item: RoadmapItem): Promise<void>;
  deleteRoadmapItem(id: number): Promise<void>;
}

export const ROLES: Role[] = ['member', 'admin'];
