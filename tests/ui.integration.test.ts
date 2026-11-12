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

  it('signed out: the landing page opens the form in the mode of the button, and closes', async () => {
    await openPage();
    expect(visible('authPanel')).toBe(false);
    expect(visible('signedOutNote')).toBe(false);
    expect($('landingArt').querySelectorAll('.lring path').length).toBeGreaterThan(5);
    (document.querySelector('[data-auth-open="signup"]') as HTMLElement).click();
    expect(visible('authPanel')).toBe(true);
    expect($('authSubmit').textContent).toBe('Criar conta');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(visible('authPanel')).toBe(false);
    (document.querySelector('[data-auth-open="signin"]') as HTMLElement).click();
    expect($('authSubmit').textContent).toBe('Iniciar sessão');
    $('authClose').click();
    expect(visible('authPanel')).toBe(false);
    // The buttons under the description do the same.
    (document.querySelector('.lcta [data-auth-open="signup"]') as HTMLElement).click();
    expect($('authSubmit').textContent).toBe('Criar conta');
    $('authClose').click();
    (document.querySelector('.lcta [data-auth-open="signin"]') as HTMLElement).click();
    expect(visible('authPanel')).toBe(true);
    expect($('authSubmit').textContent).toBe('Iniciar sessão');
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
    expect(visible('signedOutNote')).toBe(true);
    expect($('list').innerHTML).toBe('');

    await signUpThroughForm(newEmail());
    expect($('list').textContent).not.toContain('Alice only');
    expect($('sum').textContent).toContain('0,00');
  });

  it('the eye button shows and hides the password', async () => {
    await openPage();
    const toggle = $('authPass').parentElement!.querySelector<HTMLButtonElement>('.pwtoggle')!;
    expect($('authPass').type).toBe('password');
    expect(toggle.getAttribute('aria-label')).toBe('Mostrar palavra-passe');
    toggle.click();
    expect($('authPass').type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Ocultar palavra-passe');
    toggle.click();
    expect($('authPass').type).toBe('password');
  });

  it('account menu: opens My account, saves the name and changes the password', async () => {
    const email = newEmail();
    await openPage();
    await signUpThroughForm(email);
    (document.querySelector('#acct [data-view="account"]') as HTMLElement).click();
    expect(visible('viewAccount')).toBe(true);
    expect(visible('viewDashboard')).toBe(false);
    expect($('acctEmailField').value).toBe(email);

    type('acctName', 'Miguel');
    $<HTMLFormElement>('nameForm').requestSubmit();
    await until(() => $('who').textContent === 'Miguel', 'name in the menu');
    expect((await (await accountRepo(email)).getProfile()).displayName).toBe('Miguel');

    type('pwNew', 'another-password');
    type('pwConfirm', 'different');
    $<HTMLFormElement>('pwForm').requestSubmit();
    expect($('pwMsg').textContent).toBe('As palavras-passe não coincidem.');
    type('pwConfirm', 'another-password');
    $<HTMLFormElement>('pwForm').requestSubmit();
    await until(() => $('pwMsg').textContent === 'Palavra-passe alterada.', 'password changed');
    const db = createClient(URL!, KEY!, { auth: { persistSession: false } });
    expect((await db.auth.signInWithPassword({ email, password: 'another-password' })).error).toBeNull();
  });

  it('landing page: the language picker reopens the page in the chosen language', async () => {
    await openPage();
    const select = $<HTMLSelectElement>('landingLang');
    expect([...select.options].map((o) => o.value)).toEqual(['pt', 'en', 'es']);
    expect(select.value).toBe('pt');
    select.value = 'en';
    select.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('lang')).toBe('en');
    await openPage(); // the reload
    expect(document.documentElement.lang).toBe('en');
    expect($<HTMLSelectElement>('landingLang').value).toBe('en');
    expect(document.querySelector('.ltitle')!.textContent).toBe('Expense dashboard');
  });

  it('language menu: lists the languages and reopens the page in the chosen one', async () => {
    await openPage();
    await signUpThroughForm(newEmail());
    expect($('langCurrent').textContent).toBe('Português');
    expect(visible('langList')).toBe(false);
    $('langToggle').click();
    expect(visible('langList')).toBe(true);
    const options = [...document.querySelectorAll<HTMLElement>('#langList [data-lang]')];
    expect(options.map((o) => o.dataset.lang)).toEqual(['pt', 'en', 'es']);
    expect(options[0]!.getAttribute('aria-checked')).toBe('true');

    (document.querySelector('#langList [data-lang="es"]') as HTMLElement).click();
    expect(localStorage.getItem('lang')).toBe('es');
    await openPage(); // the reload
    await until(() => onDashboard(), 'dashboard after reload');
    expect(document.documentElement.lang).toBe('es');
    expect(document.title).toBe('Panel de gastos');
    expect($('langCurrent').textContent).toBe('Español');
    expect(document.querySelector('#views [data-view="settings"]')!.textContent).toBe('Ajustes');
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

  it('accounts: added in settings, balances in the overview, transfers between them, filtering by one', async () => {
    const email = newEmail();
    await openPage();
    await signUpThroughForm(email);
    // One account: just its balance, and no Account field in the form.
    expect($('ovBody').textContent).toContain('0,00');
    expect($('accL').hidden).toBe(true);

    openView('settings');
    type('an', 'Poupança');
    $<HTMLSelectElement>('ak').value = 'savings';
    type('ab', '3000');
    $('asave').click();
    await until(() => $('alist').textContent!.includes('Poupança'), 'new account listed');
    openView('dashboard');
    expect($('accL').hidden).toBe(false);

    $<HTMLSelectElement>('type').value = 't';
    $('type').dispatchEvent(new Event('change'));
    expect($('catL').hidden).toBe(true);
    $<HTMLSelectElement>('acc').value = $<HTMLSelectElement>('acc').options[0]!.value;
    $('acc').dispatchEvent(new Event('change'));
    type('amt', '500');
    $('sub').click();
    await until(() => $('list').textContent!.includes('Conta principal → Poupança'), 'transfer listed');
    expect($('ovBody').textContent).toContain('3000,00');
    expect($('ovBody').textContent).toContain('-500,00');
    expect($('sum').textContent).toContain('500,00');

    const savingsRow = [...document.querySelectorAll<HTMLElement>('.accrow')].find((b) => b.textContent!.includes('Poupança'))!;
    savingsRow.click();
    await until(() => $('ovBody').textContent!.includes('ov.showing') || !!document.querySelector('.accrow.on'), 'filtered');
    expect(document.querySelector('.accrow.on')!.textContent).toContain('Poupança');
    (document.querySelector('[data-accf=""].linkbtn') as HTMLElement).click();
    await until(() => !document.querySelector('.accrow.on'), 'filter cleared');

    // An account with transfers can't be deleted; it can be archived.
    openView('settings');
    const id = (await (await accountRepo(email)).listAccounts()).find((a) => a.name === 'Poupança')!.id;
    (document.querySelector(`[data-adel="${id}"]`) as HTMLElement).click();
    await until(() => $('tm').textContent!.length > 0, 'blocked message');
    expect((await (await accountRepo(email)).listAccounts()).find((a) => a.id === id)!.deletedAt).toBeUndefined();
  });

  it('reimbursements: a reimbursable purchase is owed until money back pays it', async () => {
    const email = newEmail();
    await openPage();
    await signUpThroughForm(email);
    type('desc', 'Jantar em viagem');
    $<HTMLSelectElement>('cat').value = 'Lazer';
    $('cat').dispatchEvent(new Event('change'));
    type('amt', '20');
    $<HTMLInputElement>('reimb').checked = true;
    $('sub').click();
    await until(() => $('list').textContent!.includes('falta receber'), 'purchase owed');
    expect($('ovBody').textContent).toContain('a receber de reembolsos');

    $<HTMLSelectElement>('type').value = 'b';
    $('type').dispatchEvent(new Event('change'));
    expect($('settleBox').hidden).toBe(false);
    expect($('reimbL').hidden).toBe(true);
    type('amt', '20');
    const box = document.querySelector<HTMLInputElement>('[data-settle]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect($<HTMLSelectElement>('cat').value).toBe('Lazer');
    expect(document.querySelector<HTMLInputElement>('[data-share]')!.value).toBe('20');
    $('sub').click();
    await until(() => $('list').textContent!.includes('reembolsada'), 'purchase paid back');
    expect($('ovBody').textContent).not.toContain('a receber de reembolsos');
    expect($('sum').textContent).toContain('0,00');

    const repo = await accountRepo(email);
    const txs = await repo.listTransactions();
    expect(txs.map((x) => [x.desc, x.amount, !!x.reimb])).toEqual([
      ['Jantar em viagem', 20, true],
      ['Jantar em viagem', -20, false],
    ]);
    expect(await repo.listLinks()).toEqual([{ repayment: txs[1]!.id, purchase: txs[0]!.id, amount: 20 }]);
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
