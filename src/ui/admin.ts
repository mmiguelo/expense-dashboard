import { escapeHtml as esc } from '../format';
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
      notify(`Couldn't save: ${friendly(message(e))}`);
    }
    await refresh();
  }

  function renderUsers(): void {
    $('userRows').innerHTML = profiles
      .map((p) => {
        const self = p.id === me.id;
        const lock = self ? ' disabled title="You can\'t change your own role or status"' : '';
        const roles = ROLES.map((r) => `<option${r === p.role ? ' selected' : ''}>${r}</option>`).join('');
        return `<tr data-user="${p.id}">
<td>${esc(p.email)}${self ? ' <span class="badge">you</span>' : ''}</td>
<td><input value="${esc(p.displayName)}" data-user-name="${p.id}" maxlength="100" aria-label="Display name for ${esc(p.email)}"></td>
<td><select data-user-role="${p.id}" aria-label="Role for ${esc(p.email)}"${lock}>${roles}</select></td>
<td>${p.active ? '<span class="badge">active</span>' : '<span class="badge off">deactivated</span>'}</td>
<td>${date(p.createdAt)}</td>
<td><button type="button" data-user-toggle="${p.id}"${lock}>${p.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>`;
      })
      .join('');
  }

  function renderDefaults(): void {
    $('defCatList').innerHTML =
      cats
        .map(
          (c) =>
            `<div class="erow" style="grid-template-columns:44px 1fr 80px auto auto"><input type="color" value="${esc(c.color)}" data-dc-color="${c.id}" aria-label="Colour of ${esc(c.name)}"><input value="${esc(c.name)}" data-dc-name="${c.id}" maxlength="100" aria-label="Name"><input type="number" value="${c.sortOrder}" data-dc-order="${c.id}" aria-label="Sort order of ${esc(c.name)}" title="Sort order"><button type="button" data-dc-save="${c.id}">Save</button><button type="button" class="x" data-dc-delete="${c.id}" aria-label="Delete ${esc(c.name)}">✕</button></div>`,
        )
        .join('') || '<div class="mute">No default categories.</div>';

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
          return `<div class="krow"><code>${esc(r.keyword.replace(/ /g, '␣'))}</code><select data-dk-cat="${r.id}" aria-label="Category for ${esc(r.keyword)}">${options}</select><button type="button" class="x" data-dk-delete="${r.id}" aria-label="Delete rule ${esc(r.keyword)}">✕</button></div>`;
        })
        .join('') || `<div class="mute">${rules.length ? 'No rules match.' : 'No default rules.'}</div>`;
  }

  async function refresh(): Promise<void> {
    try {
      [profiles, cats, rules] = await Promise.all([repo.listProfiles(), repo.listDefaultCategories(), repo.listDefaultKeywordRules()]);
    } catch (e) {
      notify(`Couldn't load the admin data: ${message(e)}`);
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
    const t = e.target as HTMLInputElement;
    const role = profile(t.dataset.userRole);
    if (role) void run(() => repo.updateProfile(role.id, { role: t.value as Profile['role'] }), `${role.email} is now ${t.value === 'admin' ? 'an admin' : 'a member'}`);
    const named = profile(t.dataset.userName);
    if (named) void run(() => repo.updateProfile(named.id, { displayName: t.value.trim() }), 'Name saved');
  });

  $('userRows').addEventListener('click', (e) => {
    const p = profile((e.target as HTMLElement).dataset.userToggle);
    if (!p) return;
    const win = doc.defaultView!;
    if (p.active && !win.confirm(`Deactivate ${p.email}? They are signed out of the data immediately. Nothing is deleted, and you can reactivate them later.`)) return;
    void run(() => repo.updateProfile(p.id, { active: !p.active }), `${p.email} ${p.active ? 'deactivated' : 'reactivated'}`);
  });

  // ---- default categories ----
  const cat = (id: string | undefined) => cats.find((c) => String(c.id) === id);
  const field = (attr: string, id: number) => doc.querySelector<HTMLInputElement>(`[${attr}="${id}"]`)!;

  $('dcAdd').addEventListener('click', () => {
    const name = $('dcName').value.trim();
    if (!name) return;
    if (cats.some((c) => c.name === name)) return notify(`There is already a default category called "${name}".`);
    const sortOrder = Math.max(0, ...cats.map((c) => c.sortOrder)) + 10;
    $('dcName').value = '';
    void run(() => repo.saveDefaultCategory({ name, color: $('dcColor').value, sortOrder }), `Added "${name}"`);
  });

  $('defCatList').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const save = cat(t.dataset.dcSave);
    if (save) {
      const changed: DefaultCategory = {
        ...save,
        name: field('data-dc-name', save.id!).value.trim() || save.name,
        color: field('data-dc-color', save.id!).value,
        sortOrder: Number(field('data-dc-order', save.id!).value) || 0,
      };
      void run(() => repo.saveDefaultCategory(changed), 'Default category saved');
    }
    const del = cat(t.dataset.dcDelete);
    if (del && doc.defaultView!.confirm(`Delete the default category "${del.name}" and its rules? Existing accounts keep theirs.`))
      void run(() => repo.deleteDefaultCategory(del.id!), `Deleted "${del.name}"`);
  });

  // ---- default keyword rules ----
  $('dkAdd').addEventListener('click', () => {
    const keyword = $('dkKeyword').value.toLowerCase();
    if (!keyword.trim()) return;
    if (rules.some((r) => r.keyword === keyword)) return notify(`There is already a default rule for "${keyword}".`);
    $('dkKeyword').value = '';
    void run(() => repo.saveDefaultKeywordRule({ keyword, category: $<HTMLSelectElement>('dkCat').value }), 'Rule added');
  });
  $('dkFilter').addEventListener('input', renderDefaults);
  $('defKwList').addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    const rule = rules.find((r) => String(r.id) === t.dataset.dkCat);
    if (rule) void run(() => repo.saveDefaultKeywordRule({ ...rule, category: t.value }));
  });
  $('defKwList').addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).dataset.dkDelete;
    if (id) void run(() => repo.deleteDefaultKeywordRule(Number(id)));
  });

  return { refresh };
}

function friendly(m: string): string {
  if (/at least one active admin/.test(m)) return 'There must always be at least one active admin.';
  if (/own role/.test(m)) return "You can't change your own role.";
  if (/deactivate your own/.test(m)) return "You can't deactivate your own account.";
  if (/duplicate key/.test(m)) return 'That name is already used.';
  return m;
}
