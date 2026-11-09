// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Real sign-ups with email confirmation take a few seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { SupabaseRepository } from '../src/storage/supabaseRepository';
import { SupabaseAdminRepository } from '../src/storage/supabaseAdminRepository';
import { confirmEmail, HAVE_DB, signUp, signUpAdmin, signUpUnconfirmed } from './support/testUsers';

// End-to-end check of the real page (index.html + src/main.ts) in jsdom against a real
// Supabase, the way a user would use it. Like supabase.integration.test.ts, it needs
// SUPABASE_TEST_URL and SUPABASE_TEST_ANON_KEY and is skipped without them.

const URL = process.env.SUPABASE_TEST_URL;
const KEY = process.env.SUPABASE_TEST_ANON_KEY;
const BODY = readFileSync('index.html', 'utf8')
  .match(/<body>([\s\S]*)<\/body>/)![1]!
  .replace(/<script[\s\S]*?<\/script>/g, '');
const PASSWORD = 'correct-horse-battery';

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const visible = (id: string) => !$(id).hidden;

async function until(cond: () => boolean, what: string, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end)
      throw new Error(`Timed out waiting for: ${what} (message: "${$('authMsg')?.textContent}", toast: "${$('tm')?.textContent}")`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Load the page as if (re)opened in the same browser: storage survives, the DOM doesn't. */
async function openPage(): Promise<void> {
  document.body.innerHTML = BODY;
  Element.prototype.scrollIntoView = () => {}; // not in jsdom
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', URL!);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', KEY!);
  await import('../src/main');
  await until(() => !visible('loading'), 'first screen');
}

function type(id: string, value: string, event = 'input'): void {
  $(id).value = value;
  $(id).dispatchEvent(new Event(event, { bubbles: true }));
}

async function signInThroughForm(email: string, password = PASSWORD): Promise<void> {
  if ($('authSubmit').textContent !== 'Iniciar sessão') $('authSwitch').click();
  type('authEmail', email);
  type('authPass', password);
  $<HTMLFormElement>('authForm').requestSubmit();
}

const onDashboard = () => visible('app') && $<HTMLSelectElement>('cat').options.length > 0;

/** Create an account, confirm it from the email, then sign in, all as a user would. */
async function signUpThroughForm(email: string): Promise<void> {
  if ($('authSubmit').textContent !== 'Criar conta') $('authSwitch').click();
  type('authEmail', email);
  type('authPass', PASSWORD);
  $<HTMLFormElement>('authForm').requestSubmit();
  await until(() => $('authMsg').textContent!.includes('confirm'), 'confirm-your-email message');
  expect(visible('app')).toBe(false);
  await confirmEmail(email);
  $('authSwitch').click(); // back to sign in
  type('authEmail', email);
  type('authPass', PASSWORD);
  $<HTMLFormElement>('authForm').requestSubmit();
  await until(() => visible('app') && $<HTMLSelectElement>('cat').options.length > 0, 'dashboard after sign-in');
}

const newEmail = () => `ui-${crypto.randomUUID()}@example.test`;

const accountRepo = async (email: string) => {
  const db = createClient(URL!, KEY!, { auth: { persistSession: false } });
  const { data } = await db.auth.signInWithPassword({ email, password: PASSWORD });
  return new SupabaseRepository(db, data.user!.id);
};

afterEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
});

const openView = (view: string) => (document.querySelector(`#views [data-view="${view}"]`) as HTMLElement).click();

describe.skipIf(!HAVE_DB)('the page, signed out and signed in', () => {
  it('signed out: shows only the sign-in screen, with no app data in the page', async () => {
    localStorage.setItem('exp-v2', JSON.stringify({ ex: [{ id: 1, date: '2026-03-01', amount: 5, desc: 'Local secret', cat: 'Fuel', type: 'e' }] }));
    await openPage();
    expect(visible('auth')).toBe(true);
    expect(visible('app')).toBe(false);
    for (const id of ['sum', 'list', 'cats', 'top', 'trend', 'rlist', 'bud']) expect($(id).innerHTML, id).toBe('');
    expect(document.body.textContent).not.toContain('Local secret');
  });

  it('wrong password shows an error and stays signed out', async () => {
    await openPage();
    type('authEmail', newEmail());
    type('authPass', 'wrong-password');
    $<HTMLFormElement>('authForm').requestSubmit();
    await until(() => $('authMsg').textContent !== '', 'error message');
    expect($('authMsg').textContent).toBe('Email ou palavra-passe incorretos.');
    expect(visible('app')).toBe(false);
  });

  it('signs up, adds an expense that is saved to the account, and stays signed in on reload', async () => {
    const email = newEmail();
    await openPage();
    await signUpThroughForm(email);
    expect($('acctEmail').textContent).toBe(email);
    expect(visible('localImport')).toBe(false);

    type('desc', 'Pingo Doce');
    type('amt', '23,40');
    $('sub').click();
    await until(() => $('list').textContent!.includes('Pingo Doce'), 'new expense in the list');
    const [saved] = await (await accountRepo(email)).listTransactions();
    expect(saved).toMatchObject({ desc: 'Pingo Doce', amount: 23.4, cat: 'Alimentação', type: 'e' });

    await openPage();
    await until(() => visible('app') && $('list').textContent!.includes('Pingo Doce'), 'still signed in after reload');
  });

  it('imports local data once, skipping duplicates when repeated', async () => {
    localStorage.setItem(
      'exp-v2',
      JSON.stringify({
        ex: [
          { id: 1773828000000.5, date: new Date().toLocaleDateString('sv'), amount: 20, desc: 'Old Lidl', cat: 'Alimentação', type: 'e', tags: '' },
          { id: 1773828000001.5, date: new Date().toLocaleDateString('sv'), amount: 7, desc: 'Old Kebab', cat: 'Takeaway', type: 'e', tags: '' },
        ],
        bud: { Alimentação: 100 },
      }),
    );
    const email = newEmail();
    await openPage();
    await signUpThroughForm(email);

    await until(() => visible('localImport'), 'import offer');
    expect($('localImportText').textContent).toContain('2 movimentos');
    $('localImportBtn').click();
    await until(() => $('tm').textContent!.startsWith('Importados'), 'import message');
    expect($('tm').textContent).toBe('Importados 2 movimentos');
    expect(visible('localImport')).toBe(false);
    expect($('list').textContent).toContain('Old Kebab');

    // Again, from Settings: nothing new.
    $('localImportSettings').click();
    await until(() => $('tm').textContent!.includes('ignorados'), 'second import message');
    expect($('tm').textContent).toBe('Importados 0 movimentos (2 já existiam, ignorados)');
    expect(await (await accountRepo(email)).listTransactions()).toHaveLength(2);

    // After a reload the offer doesn't come back for this user.
    await openPage();
    await until(() => visible('app') && $('list').textContent!.includes('Old Lidl'), 'dashboard');
    expect(visible('localImport')).toBe(false);
  });

  it("a second user sees none of the first user's data", async () => {
    const alice = newEmail();
    await openPage();
    await signUpThroughForm(alice);
    type('desc', 'Alice only');
    type('amt', '99');
    $('sub').click();
    await until(() => $('list').textContent!.includes('Alice only'), "Alice's expense");

    // Log out (the reload is simulated by opening the page again), then Bob signs up.
    $('logout').click();
    await until(() => !Object.keys(localStorage).some((k) => k.startsWith('sb-')), 'session removed');
    await openPage();
    expect(visible('auth')).toBe(true);
    expect($('list').innerHTML).toBe('');

    await signUpThroughForm(newEmail());
    expect($('list').textContent).not.toContain('Alice only');
    expect($('sum').textContent).toContain('0,00');
  });

  it('shows the account menu with email and role; members get no Admin screen', async () => {
    const email = newEmail();
    await openPage();
    await signUpThroughForm(email);
    expect($('acctEmail').textContent).toBe(email);
    expect($('acctRole').textContent).toBe('Membro');
    expect(visible('adminNav')).toBe(false);
    expect($('userRows').innerHTML).toBe('');
  });

  it('settings: add, recolor, rename and delete categories, keeping transactions in step', async () => {
    await openPage();
    await signUpThroughForm(newEmail());
    type('desc', 'Pingo Doce');
    type('amt', '10');
    $('sub').click();
    await until(() => $('list').textContent!.includes('Alimentação'), 'expense in Alimentação');

    openView('settings');
    type('nc', 'Pets');
    type('ncc', '#123456');
    $('ncb').click();
    await until(() => !!document.querySelector('[data-cat-name="Pets"]'), 'new category');
    expect(document.querySelector<HTMLInputElement>('[data-cat-color="Pets"]')!.value).toBe('#123456');

    const color = document.querySelector<HTMLInputElement>('[data-cat-color="Alimentação"]')!;
    color.value = '#ff0000';
    color.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => document.querySelector<HTMLInputElement>('[data-cat-color="Alimentação"]')?.value === '#ff0000', 'recolor saved');

    document.querySelector<HTMLInputElement>('[data-cat-name="Alimentação"]')!.value = 'Food';
    (document.querySelector('[data-cat-rename="Alimentação"]') as HTMLElement).click();
    await until(() => $('list').textContent!.includes('Food'), 'renamed in the list');
    expect($('list').textContent).not.toContain('Alimentação');

    (document.querySelector('[data-cat-delete="Food"]') as HTMLElement).click();
    expect(visible('catDelete')).toBe(true);
    expect($('catDeleteText').textContent).toContain('usada por 1 movimento');
    $<HTMLSelectElement>('catDeleteTo').value = 'Pets';
    $('catDeleteOk').click();
    await until(() => $('list').textContent!.includes('Pets'), 'moved to Pets');
    expect(document.querySelector('[data-cat-name="Food"]')).toBeNull();
  });

  it('settings: keyword rules drive the category guess', async () => {
    await openPage();
    await signUpThroughForm(newEmail());
    openView('settings');
    type('kwNew', 'Vet');
    $<HTMLSelectElement>('kwNewCat').value = 'Saúde';
    $('kwAdd').click();
    await until(() => $('kwList').textContent!.includes('vet'), 'rule listed');
    openView('dashboard');
    type('desc', 'Vet appointment');
    expect($<HTMLSelectElement>('cat').value).toBe('Saúde');
  });

  it('subcategories: guessed from the description, saved, and managed in settings', async () => {
    const email = newEmail();
    await openPage();
    await signUpThroughForm(email);
    type('desc', 'Netflix março');
    expect($<HTMLSelectElement>('cat').value).toBe('Subscrições');
    expect($<HTMLSelectElement>('subcat').value).toBe('Netflix');
    type('amt', '13,99');
    $('sub').click();
    await until(() => $('list').textContent!.includes('Subscrições › Netflix'), 'expense with its subcategory');

    $<HTMLSelectElement>('type').value = 'i';
    $('type').dispatchEvent(new Event('change'));
    expect($<HTMLSelectElement>('cat').value).toBe('Rendimentos');
    type('desc', 'Salário outubro');
    expect($<HTMLSelectElement>('subcat').value).toBe('Salário');
    type('amt', '1500');
    $('sub').click();
    await until(() => $('list').textContent!.includes('Rendimentos › Salário'), 'income with its subcategory');
    const saved = await (await accountRepo(email)).listTransactions();
    expect(saved.map((x) => [x.cat, x.sub, x.type])).toEqual([
      ['Subscrições', 'Netflix', 'e'],
      ['Rendimentos', 'Salário', 'i'],
    ]);

    openView('settings');
    expect(document.querySelector('[data-cat-rename="Rendimentos"]')).toBeNull();
    const input = document.querySelector<HTMLInputElement>('[data-sub-new="Lazer"]')!;
    input.value = 'Bowling';
    (document.querySelector('[data-sub-add="Lazer"]') as HTMLElement).click();
    await until(() => !!document.querySelector('[data-sub-delete="Bowling"]'), 'new subcategory listed');
    (document.querySelector('[data-sub-delete="Bowling"][data-sub-cat="Lazer"]') as HTMLElement).click();
    await until(() => !document.querySelector('[data-sub-delete="Bowling"]'), 'subcategory deleted');
  });

  it('settings: sections collapse to their heading, remembered on reload', async () => {
    await openPage();
    await signUpThroughForm(newEmail());
    openView('settings');
    localStorage.removeItem('folded-sections');
    await openPage();
    await until(onDashboard, 'dashboard');
    const sections = ['secCategories', 'secRules', 'secBudgets', 'secRecurring', 'secBackup'];
    expect(sections.filter((id) => $(id).classList.contains('folded'))).toEqual(sections);
    const button = () => document.querySelector<HTMLButtonElement>('#secRules .foldbtn')!;
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(button().title).toBe('Mostrar mais');
    button().click();
    expect($('secRules').classList.contains('folded')).toBe(false);
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(button().title).toBe('Mostrar menos');

    await openPage();
    await until(onDashboard, 'dashboard after reload');
    expect(sections.filter((id) => !$(id).classList.contains('folded'))).toEqual(['secRules']);
  });

  it('wrong password: a friendly message and a visible cooldown', async () => {
    await openPage();
    await signInThroughForm(newEmail(), 'wrong-password');
    await until(() => $('authMsg').textContent !== '', 'error');
    expect($('authMsg').textContent).toBe('Email ou palavra-passe incorretos.');
    expect($<HTMLButtonElement>('authSubmit').disabled).toBe(true);
    expect($('authSubmit').textContent).toMatch(/^Iniciar sessão \(\ds\)$/);
  });

  it('an unconfirmed account cannot sign in, and is offered a new confirmation email', async () => {
    const { email } = await signUpUnconfirmed();
    // Supabase allows one email per address per interval (1 s locally, 60 s in production).
    await new Promise((r) => setTimeout(r, 1500));
    await openPage();
    await signInThroughForm(email);
    await until(() => $('authMsg').textContent !== '', 'error');
    expect($('authMsg').textContent).toMatch(/Confirme primeiro o seu email/);
    expect(visible('authResendRow')).toBe(true);
    expect(visible('app')).toBe(false);
    $('authResend').click();
    await until(() => $('authMsg').textContent!.includes('novo link de confirmação'), 'resend message');
    expect($<HTMLButtonElement>('authResend').disabled).toBe(true);
  });

  it('admin: sees the Admin screen, lists accounts, and cannot change their own role', async () => {
    const admin = await signUpAdmin();
    const member = await signUp('listed');
    await openPage();
    await signInThroughForm(admin.email);
    await until(onDashboard, 'dashboard');
    expect($('acctRole').textContent).toBe('Administrador');
    expect(visible('adminNav')).toBe(true);
    openView('admin');
    await until(() => $('userRows').textContent!.includes(member.email), 'member listed');
    expect(document.querySelector<HTMLSelectElement>(`[data-user-role="${admin.id}"]`)!.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(`[data-user-toggle="${admin.id}"]`)!.disabled).toBe(true);
    // Account info only: the member's expenses are nowhere on the page.
    expect(document.body.textContent).not.toContain('Member private');
  });

  it('admin: deactivating locks the member out at once; reactivating restores their data', async () => {
    const admin = await signUpAdmin();
    const member = await signUp('locked');
    await openPage();
    await signInThroughForm(member.email);
    await until(onDashboard, 'member dashboard');
    type('desc', 'Member private');
    type('amt', '5');
    $('sub').click();
    await until(() => $('list').textContent!.includes('Member private'), "member's expense");

    // The admin deactivates the member from another device while the member's page is open.
    await new SupabaseAdminRepository(admin.db).updateProfile(member.id, { active: false });
    // Their next change is refused by the database, and the page shows why.
    type('desc', 'After deactivation');
    type('amt', '1');
    $('sub').click();
    await until(() => visible('deactivated'), 'deactivated screen');
    expect(visible('app')).toBe(false);

    // Signing in again while deactivated: the deactivated screen, no data.
    $('deactivatedLogout').click();
    await until(() => !Object.keys(localStorage).some((k) => k.startsWith('sb-')), 'signed out');
    await openPage();
    await signInThroughForm(member.email);
    await until(() => visible('deactivated'), 'deactivated screen after sign-in');
    expect($('list').innerHTML).toBe('');

    await new SupabaseAdminRepository(admin.db).updateProfile(member.id, { active: true });
    await openPage();
    await until(() => onDashboard() && $('list').textContent!.includes('Member private'), 'data back after reactivation');
  });

  it('admin: deactivates and reactivates from the Users tab, and edits the defaults', async () => {
    window.confirm = () => true;
    const admin = await signUpAdmin();
    const member = await signUp('toggled');
    await openPage();
    await signInThroughForm(admin.email);
    await until(onDashboard, 'dashboard');
    openView('admin');
    await until(() => !!document.querySelector(`[data-user-toggle="${member.id}"]`), 'member row');
    (document.querySelector(`[data-user-toggle="${member.id}"]`) as HTMLElement).click();
    await until(() => document.querySelector(`[data-user-toggle="${member.id}"]`)?.textContent === 'Reativar', 'deactivated');
    (document.querySelector(`[data-user-toggle="${member.id}"]`) as HTMLElement).click();
    await until(() => document.querySelector(`[data-user-toggle="${member.id}"]`)?.textContent === 'Desativar', 'reactivated');

    (document.querySelector('#adminTabs [data-tab="defaults"]') as HTMLElement).click();
    expect(visible('adminDefaults')).toBe(true);
    const name = `Hobbies ${crypto.randomUUID().slice(0, 4)}`;
    type('dcName', name);
    $('dcAdd').click();
    await until(() => $('defCatList').innerHTML.includes(name), 'default category added');
    const newcomer = await signUp('newcomer');
    const { data } = await newcomer.db.from('categories').select('name').eq('name', name);
    expect(data).toEqual([{ name }]);
    // Leave the defaults as they were.
    const repo = new SupabaseAdminRepository(admin.db);
    await repo.deleteDefaultCategory((await repo.listDefaultCategories()).find((c) => c.name === name)!.id!);
  });
});
