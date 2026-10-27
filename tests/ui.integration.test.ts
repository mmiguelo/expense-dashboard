// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseRepository } from '../src/storage/supabaseRepository';

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
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Load the page as if (re)opened in the same browser: storage survives, the DOM doesn't. */
async function openPage(): Promise<void> {
  document.body.innerHTML = BODY;
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

async function signUpThroughForm(email: string): Promise<void> {
  if ($('authSubmit').textContent !== 'Create account') $('authSwitch').click();
  type('authEmail', email);
  type('authPass', PASSWORD);
  $<HTMLFormElement>('authForm').requestSubmit();
  await until(() => visible('app') && $<HTMLSelectElement>('cat').options.length > 0, 'dashboard after sign-up');
}

const newEmail = () => `ui-${crypto.randomUUID()}@example.test`;

const accountRepo = async (email: string) => {
  const db = createClient(URL!, KEY!, { auth: { persistSession: false } });
  await db.auth.signInWithPassword({ email, password: PASSWORD });
  return new SupabaseRepository(db);
};

afterEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
});

describe.skipIf(!URL || !KEY)('the page, signed out and signed in', () => {
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
    expect($('authMsg').textContent).toBe('Wrong email or password.');
    expect(visible('app')).toBe(false);
  });

  it('signs up, adds an expense that is saved to the account, and stays signed in on reload', async () => {
    const email = newEmail();
    await openPage();
    await signUpThroughForm(email);
    expect($('who').textContent).toBe(email);
    expect(visible('localImport')).toBe(false);

    type('desc', 'Pingo Doce');
    type('amt', '23,40');
    $('sub').click();
    await until(() => $('list').textContent!.includes('Pingo Doce'), 'new expense in the list');
    const [saved] = await (await accountRepo(email)).listTransactions();
    expect(saved).toMatchObject({ desc: 'Pingo Doce', amount: 23.4, cat: 'Groceries', type: 'e' });

    await openPage();
    await until(() => visible('app') && $('list').textContent!.includes('Pingo Doce'), 'still signed in after reload');
  });

  it('imports local data once, skipping duplicates when repeated', async () => {
    localStorage.setItem(
      'exp-v2',
      JSON.stringify({
        ex: [
          { id: 1773828000000.5, date: new Date().toLocaleDateString('sv'), amount: 20, desc: 'Old Lidl', cat: 'Groceries', type: 'e', tags: '' },
          { id: 1773828000001.5, date: new Date().toLocaleDateString('sv'), amount: 7, desc: 'Old Kebab', cat: 'Takeaway', type: 'e', tags: '' },
        ],
        bud: { Groceries: 100 },
      }),
    );
    const email = newEmail();
    await openPage();
    await signUpThroughForm(email);

    await until(() => visible('localImport'), 'import offer');
    expect($('localImportText').textContent).toContain('2 transactions');
    $('localImportBtn').click();
    await until(() => $('tm').textContent!.startsWith('Imported'), 'import message');
    expect($('tm').textContent).toBe('Imported 2 transactions');
    expect(visible('localImport')).toBe(false);
    expect($('list').textContent).toContain('Old Kebab');

    // Again, from Settings: nothing new.
    $('localImportSettings').click();
    await until(() => $('tm').textContent!.includes('skipped'), 'second import message');
    expect($('tm').textContent).toBe('Imported 0 transactions (2 already there, skipped)');
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
});
