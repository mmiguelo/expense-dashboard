import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeKeyword } from '../categories';
import { t } from '../i18n';
import type { Profile } from '../types';
import type { AdminRepository, DefaultCategory, DefaultKeywordRule, RoadmapItem } from './adminRepository';
import { profileFromRow, toError, type ProfileRow } from './supabaseRepository';

// Row Level Security only lets active admins read other profiles or change the defaults;
// for anyone else these calls return nothing or fail.

const check = ({ error }: { error: unknown }) => {
  if (error) throw toError(error);
};

export class SupabaseAdminRepository implements AdminRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listProfiles(): Promise<Profile[]> {
    const { data, error } = await this.db
      .from('profiles')
      .select('id, email, display_name, role, active, owner, created_at')
      .order('created_at');
    if (error) throw toError(error);
    return (data as ProfileRow[]).map(profileFromRow);
  }

  async updateProfile(id: string, changes: Partial<Pick<Profile, 'role' | 'active' | 'displayName'>>): Promise<void> {
    const row: Record<string, unknown> = {};
    if (changes.role !== undefined) row.role = changes.role;
    if (changes.active !== undefined) row.active = changes.active;
    if (changes.displayName !== undefined) row.display_name = changes.displayName;
    const { data, error } = await this.db.from('profiles').update(row).eq('id', id).select('id');
    if (error) throw toError(error);
    if (!data?.length) throw new Error(t('admin.err.notAllowed'));
  }

  async listDefaultCategories(): Promise<DefaultCategory[]> {
    const { data, error } = await this.db.from('default_categories').select('id, name, color, sort_order, kind').order('sort_order').order('id');
    if (error) throw toError(error);
    return (data ?? []).map((r) => ({ id: Number(r.id), name: r.name, color: r.color, sortOrder: r.sort_order, kind: r.kind }));
  }

  async saveDefaultCategory({ id, name, color, sortOrder, kind }: DefaultCategory): Promise<void> {
    const row = { name: name.trim(), color, sort_order: sortOrder };
    if (id === undefined) check(await this.db.from('default_categories').insert({ ...row, kind: kind ?? 'expense' }));
    else check(await this.db.from('default_categories').update(row).eq('id', id));
  }

  async deleteDefaultCategory(id: number): Promise<void> {
    check(await this.db.from('default_categories').delete().eq('id', id));
  }

  async listDefaultKeywordRules(): Promise<DefaultKeywordRule[]> {
    const { data, error } = await this.db.from('default_keyword_rules').select('id, category, keyword').order('id');
    if (error) throw toError(error);
    return (data ?? []).map((r) => ({ id: Number(r.id), category: r.category, keyword: r.keyword }));
  }

  async saveDefaultKeywordRule({ id, category, keyword }: DefaultKeywordRule): Promise<void> {
    const row = { category, keyword: normalizeKeyword(keyword) };
    if (id === undefined) check(await this.db.from('default_keyword_rules').insert(row));
    else check(await this.db.from('default_keyword_rules').update(row).eq('id', id));
  }

  async deleteDefaultKeywordRule(id: number): Promise<void> {
    check(await this.db.from('default_keyword_rules').delete().eq('id', id));
  }

  async listRoadmap(): Promise<RoadmapItem[]> {
    const { data, error } = await this.db.from('roadmap_items').select('id, text, done').order('id');
    if (error) throw toError(error);
    return (data ?? []).map((r) => ({ id: Number(r.id), text: r.text, done: r.done }));
  }

  async saveRoadmapItem({ id, text, done }: RoadmapItem): Promise<void> {
    const row = { text: text.trim(), done };
    if (id === undefined) check(await this.db.from('roadmap_items').insert(row));
    else check(await this.db.from('roadmap_items').update(row).eq('id', id));
  }

  async deleteRoadmapItem(id: number): Promise<void> {
    check(await this.db.from('roadmap_items').delete().eq('id', id));
  }
}
