import type { Session, SupabaseClient } from '@supabase/supabase-js';
import './styles.css';
import { readSupabaseConfig } from './config';
import { initLang, t, tn, translateError, translatePage } from './i18n';
import { LegacyLocalStore } from './storage/legacyLocalStore';
import { foldedSections, markSignedOut, saveFoldedSections, saveLanguage, savedLanguage, takeSignedOut } from './storage/preferences';
import { SupabaseAdminRepository } from './storage/supabaseAdminRepository';
import { createSupabaseClient } from './storage/supabaseClient';
import { SupabaseRepository } from './storage/supabaseRepository';
import type { Profile } from './types';
import { startAdmin, type AdminHandle } from './ui/admin';
import { setupAccount } from './ui/account';
import { setupAuthScreen, setupRecoveryScreen } from './ui/auth';
import { setupFolding } from './ui/folding';
import { donutSvg, setupLanding } from './ui/landing';
import { setupLanguageMenu, setupLanguageSelect } from './ui/language';
import { setupPasswordToggles } from './ui/password';
import { importMessage, startApp, type AppHandle } from './ui/app';
import { setCurrency } from './format';

const SCREENS = ['loading', 'configError', 'auth', 'recovery', 'deactivated', 'app'] as const;
type Screen = (typeof SCREENS)[number];
const VIEWS = ['dashboard', 'account', 'settings', 'admin'] as const;
type View = (typeof VIEWS)[number];

const $ = (id: string) => document.getElementById(id)!;

/** Show one screen. The dashboard is only ever filled in after sign-in. */
function show(screen: Screen): void {
  for (const s of SCREENS) $(s).hidden = s !== screen;
}

function main(): void {
  initLang(savedLanguage());
  translatePage(document);
  $('spinner').innerHTML = donutSvg();
  setupPasswordToggles(document);
  // Everything on the page was drawn in the old language: start again in the new one.
  const chooseLanguage = (lang: string) => {
    saveLanguage(lang);
    location.reload();
  };
  setupLanguageMenu(document, chooseLanguage);
  setupLanguageSelect($('landingLang') as HTMLSelectElement, chooseLanguage);
  setupFolding(document, foldedSections(), saveFoldedSections);
  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseClient(readSupabaseConfig());
  } catch (e) {
    $('configMsg').textContent = (e as Error).message;
    show('configError');
    return;
  }

  const landing = setupLanding(document, setupAuthScreen(document, supabase));
  if (takeSignedOut()) landing.showSignedOut();
  let started: Promise<unknown> | null = null;
  // Arriving from a password-reset email.
  let recovering = /type=recovery/.test(location.hash);

  setupRecoveryScreen(document, supabase, () => {
    recovering = false;
    void supabase.auth.getSession().then(({ data }) => onSession(data.session));
  });

  function onSession(session: Session | null): void {
    if (recovering) return show('recovery');
    if (session) {
      started ??= startSignedIn(supabase, session).catch((e) => {
        $('configMsg').textContent = t('err.load', { message: translateError((e as Error).message) });
        show('configError');
      });
    } else if (started) {
      // Signed out (here or in another tab) or the session ended: drop everything in memory.
      location.reload();
    } else show('auth');
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') recovering = true;
    // Supabase advises against calling it from inside this callback; defer.
    setTimeout(() => onSession(session), 0);
  });

  const logout = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    // Back to the landing page, with a "signed out" note.
    markSignedOut();
    location.reload();
  };
  $('logout').addEventListener('click', logout);
  $('deactivatedLogout').addEventListener('click', logout);
}

function showDeactivated(profile: Pick<Profile, 'email'>): void {
  $('deactivatedWho').textContent = t('account.signedInAs', { email: profile.email });
  show('deactivated');
}

async function startSignedIn(supabase: SupabaseClient, session: Session): Promise<void> {
  // The wheel turns until the dashboard has its data, so it never shows half-filled.
  show('loading');
  const repo = new SupabaseRepository(supabase, session.user.id);
  const profile = await repo.getProfile();
  if (!profile.active) return showDeactivated(profile);
  // Amounts and labels in the user's currency.
  setCurrency(profile.currency);
  translatePage(document);

  showAccount(profile);
  let deactivated = false;
  const app = await startApp({
    doc: document,
    repo,
    onDeactivated: () => {
      deactivated = true;
      showDeactivated(profile);
    },
  });
  if (!deactivated) show('app');

  let admin: AdminHandle | null = null;
  setupViews(async (view) => {
    if (view !== 'admin' || profile.role !== 'admin') return;
    admin ??= startAdmin({ doc: document, repo: new SupabaseAdminRepository(supabase), me: profile, notify: app.notify });
    await admin.refresh();
  });
  $('adminNav').hidden = profile.role !== 'admin';
  setupAccount({
    doc: document,
    supabase,
    repo,
    profile,
    notify: app.notify,
    onNameChanged: (name) => showAccount({ ...profile, displayName: name }),
    hasEntries: app.hasEntries,
    onCurrencyChanged: () => location.reload(),
  });

  // Coming back to the tab: pick up changes from other devices, and deactivation.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void app.refresh().catch(() => {});
  });

  offerLocalImport(repo, app, session.user.id);
}

function showAccount(profile: Profile): void {
  $('who').textContent = profile.displayName || profile.email;
  $('acctEmail').textContent = profile.email;
  $('acctRole').textContent = t(profile.role === 'admin' ? 'role.admin' : 'role.member');
  $('acctRole').className = `badge ${profile.role === 'admin' ? 'admin' : ''}`;
}

/** Screens open from the tabs and from the account menu. */
function setupViews(onOpen: (view: View) => Promise<void>): void {
  const ids: Record<View, string> = { dashboard: 'viewDashboard', account: 'viewAccount', settings: 'viewSettings', admin: 'viewAdmin' };
  const open = (e: Event) => {
    const view = (e.target as HTMLElement).closest<HTMLElement>('[data-view]')?.dataset.view as View | undefined;
    if (!view) return;
    for (const v of VIEWS) $(ids[v]).hidden = v !== view;
    document.querySelectorAll<HTMLElement>('#views button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    ($('acct') as HTMLDetailsElement).open = false;
    void onOpen(view);
  };
  $('views').addEventListener('click', open);
  $('acct').addEventListener('click', open);
}

/** Offer to upload data saved in this browser before accounts existed. */
function offerLocalImport(repo: SupabaseRepository, app: AppHandle, userId: string): void {
  const local = new LegacyLocalStore();
  if (!local.hasData()) return;

  const settingsButton = $('localImportSettings');
  settingsButton.hidden = false;
  if (!local.wasImportedBy(userId)) {
    const n = local.transactionCount;
    $('localImportText').textContent = tn('localImport.text', n);
    $('localImport').hidden = false;
  }

  const run = async (button: HTMLElement) => {
    (button as HTMLButtonElement).disabled = true;
    try {
      const result = await repo.importSnapshot(local.snapshot(), { replace: false });
      local.markImportedBy(userId);
      $('localImport').hidden = true;
      await app.refresh();
      app.notify(importMessage(result));
    } catch (e) {
      app.notify(t('import.failed', { message: translateError((e as Error).message) }));
    } finally {
      (button as HTMLButtonElement).disabled = false;
    }
  };
  $('localImportBtn').addEventListener('click', (e) => void run(e.currentTarget as HTMLElement));
  settingsButton.addEventListener('click', (e) => void run(e.currentTarget as HTMLElement));
  $('localImportLater').addEventListener('click', () => ($('localImport').hidden = true));
}

main();
