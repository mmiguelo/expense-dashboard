import { escapeHtml as esc } from '../format';
import { t, translateError } from '../i18n';
import { ROLES, type AdminRepository, type DefaultCategory, type DefaultKeywordRule } from '../storage/adminRepository';
import type { Profile } from '../types';

// The Admin screen: accounts, and the defaults new accounts start with. What it may do is
// decided by the database (RLS and the profile guard), not by this code; it only hides
// controls that would be refused anyway, like changing your own role.

export interface AdminOptions {
  doc: Document;
  repo: AdminRepository;
  /** The signed-in admin. */
  me: Profile;
  notify(message: string): void;
}

export interface AdminHandle {
  refresh(): Promise<void>;
}

const date = (iso: string) => new Date(iso).toLocaleDateString('pt-PT');

export function startAdmin({ doc, repo, me, notify }: AdminOptions): AdminHandle {
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => doc.getElementById(id) as T;
  let profiles: Profile[] = [];
  let cats: DefaultCategory[] = [];
  let rules: DefaultKeywordRule[] = [];

  const message = (e: unknown) => (e as Error)?.message ?? String(e);

  async function run(change: () => Promise<void>, done?: string): Promise<void> {
    try {
      await change();
      if (done) notify(done);
    } catch (e) {
      notify(t('admin.saveFailed', { message: translateError(message(e)) }));
    }
    await refresh();
  }

  function renderUsers(): void {
    $('userRows').innerHTML = profiles
      .map((p) => {
        const self = p.id === me.id;
        // Only the owner may demote or deactivate an admin; nobody may touch the owner.
        const why = self ? 'admin.lockTitle' : p.owner ? 'admin.ownerLockTitle' : p.role === 'admin' && !me.owner ? 'admin.adminLockTitle' : '';
        const lockRole = why ? ` disabled title="${esc(t(why))}"` : '';
        // A non-owner admin may still reactivate a deactivated admin.
        const lockToggle = why && !(why === 'admin.adminLockTitle' && !p.active) ? lockRole : '';
        const roles = ROLES.map((r) => `<option value="${r}"${r === p.role ? ' selected' : ''}>${t(`role.${r}`)}</option>`).join('');
        return `<tr data-user="${p.id}">
<td>${esc(p.email)}${self ? ` <span class="badge">${t('admin.you')}</span>` : ''}${p.owner ? ` <span class="badge">${t('admin.owner')}</span>` : ''}</td>
<td><input value="${esc(p.displayName)}" data-user-name="${p.id}" maxlength="100" aria-label="${esc(t('admin.displayNameFor', { email: p.email }))}"></td>
<td><select data-user-role="${p.id}" aria-label="${esc(t('admin.roleFor', { email: p.email }))}"${lockRole}>${roles}</select></td>
<td>${p.active ? `<span class="badge">${t('admin.active')}</span>` : `<span class="badge off">${t('admin.deactivated')}</span>`}</td>
<td>${date(p.createdAt)}</td>
<td><button type="button" data-user-toggle="${p.id}"${lockToggle}>${t(p.active ? 'admin.deactivate' : 'admin.reactivate')}</button></td></tr>`;
      })
      .join('');
  }

  function renderDefaults(): void {
    $('defCatList').innerHTML =
      cats
        .map(
          (c) =>
            `<div class="erow" style="grid-template-columns:44px 1fr 80px auto auto"><input type="color" value="${esc(c.color)}" data-dc-color="${c.id}" aria-label="${esc(t('cat.colourOf', { name: c.name }))}"><input value="${esc(c.name)}" data-dc-name="${c.id}" maxlength="100" aria-label="${esc(t('common.name'))}" title="${esc(t(c.kind === 'income' ? 'cat.incomes' : 'cat.expenses'))}"><input type="number" value="${c.sortOrder}" data-dc-order="${c.id}" aria-label="${esc(t('admin.sortOrderOf', { name: c.name }))}" title="${esc(t('admin.sortOrder'))}"><button type="button" data-dc-save="${c.id}">${t('common.save')}</button><button type="button" class="x" data-dc-delete="${c.id}" aria-label="${esc(t('cat.deleteNamed', { name: c.name }))}">✕</button></div>`,
        )
        .join('') || `<div class="mute">${t('admin.noDefaultCategories')}</div>`;

    const sel = $<HTMLSelectElement>('dkCat');
    const keep = sel.value;
    sel.innerHTML = cats.map((c) => `<option>${esc(c.name)}</option>`).join('');
    if (keep) sel.value = keep;

    const f = $('dkFilter').value.toLowerCase().trim();
    const shown = rules.filter((r) => !f || r.keyword.includes(f) || r.category.toLowerCase().includes(f));
    $('defKwList').innerHTML =
      shown
        .map((r) => {
          const options = cats.map((c) => `<option${c.name === r.category ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
          return `<div class="krow"><code>${esc(r.keyword.replace(/ /g, '␣'))}</code><select data-dk-cat="${r.id}" aria-label="${esc(t('rules.categoryFor', { keyword: r.keyword }))}">${options}</select><button type="button" class="x" data-dk-delete="${r.id}" aria-label="${esc(t('rules.deleteNamed', { keyword: r.keyword }))}">✕</button></div>`;
        })
        .join('') || `<div class="mute">${t(rules.length ? 'rules.noMatch' : 'admin.noDefaultRules')}</div>`;
  }

  async function refresh(): Promise<void> {
    try {
      [profiles, cats, rules] = await Promise.all([repo.listProfiles(), repo.listDefaultCategories(), repo.listDefaultKeywordRules()]);
    } catch (e) {
      notify(t('admin.loadFailed', { message: translateError(message(e)) }));
    }
    renderUsers();
    renderDefaults();
  }

  // ---- tabs ----
  $('adminTabs').addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).dataset.tab;
    if (!tab) return;
    doc.querySelectorAll<HTMLElement>('#adminTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('adminUsers').hidden = tab !== 'users';
    $('adminDefaults').hidden = tab !== 'defaults';
  });

  // ---- users ----
  const profile = (id: string | undefined) => profiles.find((p) => p.id === id);

  $('userRows').addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    const role = profile(target.dataset.userRole);
    if (role) void run(() => repo.updateProfile(role.id, { role: target.value as Profile['role'] }), t(target.value === 'admin' ? 'admin.nowAdmin' : 'admin.nowMember', { email: role.email }));
    const named = profile(target.dataset.userName);
    if (named) void run(() => repo.updateProfile(named.id, { displayName: target.value.trim() }), t('admin.nameSaved'));
  });

  $('userRows').addEventListener('click', (e) => {
    const p = profile((e.target as HTMLElement).dataset.userToggle);
    if (!p) return;
    const win = doc.defaultView!;
    if (p.active && !win.confirm(t('admin.confirmDeactivate', { email: p.email }))) return;
    void run(() => repo.updateProfile(p.id, { active: !p.active }), t(p.active ? 'admin.wasDeactivated' : 'admin.wasReactivated', { email: p.email }));
  });

  // ---- default categories ----
  const cat = (id: string | undefined) => cats.find((c) => String(c.id) === id);
  const field = (attr: string, id: number) => doc.querySelector<HTMLInputElement>(`[${attr}="${id}"]`)!;

  $('dcAdd').addEventListener('click', () => {
    const name = $('dcName').value.trim();
    if (!name) return;
    if (cats.some((c) => c.name === name)) return notify(t('admin.categoryExists', { name }));
    const sortOrder = Math.max(0, ...cats.map((c) => c.sortOrder)) + 10;
    $('dcName').value = '';
    void run(() => repo.saveDefaultCategory({ name, color: $('dcColor').value, sortOrder, kind: $<HTMLSelectElement>('dcKind').value as DefaultCategory['kind'] }), t('admin.added', { name }));
  });

  $('defCatList').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const save = cat(target.dataset.dcSave);
    if (save) {
      const changed: DefaultCategory = {
        ...save,
        name: field('data-dc-name', save.id!).value.trim() || save.name,
        color: field('data-dc-color', save.id!).value,
        sortOrder: Number(field('data-dc-order', save.id!).value) || 0,
      };
      void run(() => repo.saveDefaultCategory(changed), t('admin.categorySaved'));
    }
    const del = cat(target.dataset.dcDelete);
    if (del && doc.defaultView!.confirm(t('admin.confirmDeleteCategory', { name: del.name })))
      void run(() => repo.deleteDefaultCategory(del.id!), t('admin.deleted', { name: del.name }));
  });

  // ---- default keyword rules ----
  $('dkAdd').addEventListener('click', () => {
    const keyword = $('dkKeyword').value.toLowerCase();
    if (!keyword.trim()) return;
    if (rules.some((r) => r.keyword === keyword)) return notify(t('admin.ruleExists', { keyword }));
    $('dkKeyword').value = '';
    void run(() => repo.saveDefaultKeywordRule({ keyword, category: $<HTMLSelectElement>('dkCat').value }), t('admin.ruleAdded'));
  });
  $('dkFilter').addEventListener('input', renderDefaults);
  $('defKwList').addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    const rule = rules.find((r) => String(r.id) === target.dataset.dkCat);
    if (rule) void run(() => repo.saveDefaultKeywordRule({ ...rule, category: target.value }));
  });
  $('defKwList').addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).dataset.dkDelete;
    if (id) void run(() => repo.deleteDefaultKeywordRule(Number(id)));
  });

  return { refresh };
}

