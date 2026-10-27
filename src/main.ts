import type { Session, SupabaseClient } from '@supabase/supabase-js';
import './styles.css';
import { readSupabaseConfig } from './config';
import { LegacyLocalStore } from './storage/legacyLocalStore';
import { SupabaseAdminRepository } from './storage/supabaseAdminRepository';
import { createSupabaseClient } from './storage/supabaseClient';
import { SupabaseRepository } from './storage/supabaseRepository';
import type { Profile } from './types';
import { startAdmin, type AdminHandle } from './ui/admin';
import { setupAuthScreen, setupRecoveryScreen } from './ui/auth';
import { importMessage, startApp, type AppHandle } from './ui/app';

const SCREENS = ['loading', 'configError', 'auth', 'recovery', 'deactivated', 'app'] as const;
type Screen = (typeof SCREENS)[number];
const VIEWS = ['dashboard', 'settings', 'admin'] as const;
type View = (typeof VIEWS)[number];

const $ = (id: string) => document.getElementById(id)!;

/** Show one screen. The dashboard is only ever filled in after sign-in. */
function show(screen: Screen): void {
  for (const s of SCREENS) $(s).hidden = s !== screen;
}

function main(): void {
  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseClient(readSupabaseConfig());
  } catch (e) {
    $('configMsg').textContent = (e as Error).message;
    show('configError');
    return;
  }

  setupAuthScreen(document, supabase);
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
        $('configMsg').textContent = `Couldn't load your data: ${(e as Error).message}. Reload the page to try again.`;
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
    location.reload();
  };
  $('logout').addEventListener('click', logout);
  $('deactivatedLogout').addEventListener('click', logout);
}

function showDeactivated(profile: Pick<Profile, 'email'>): void {
  $('deactivatedWho').textContent = `Signed in as ${profile.email}.`;
  show('deactivated');
}

async function startSignedIn(supabase: SupabaseClient, session: Session): Promise<void> {
  const repo = new SupabaseRepository(supabase, session.user.id);
  const profile = await repo.getProfile();
  if (!profile.active) return showDeactivated(profile);

  showAccount(profile);
  show('app');
  const app = await startApp({ doc: document, repo, onDeactivated: () => showDeactivated(profile) });

  let admin: AdminHandle | null = null;
  setupViews(async (view) => {
    if (view !== 'admin' || profile.role !== 'admin') return;
    admin ??= startAdmin({ doc: document, repo: new SupabaseAdminRepository(supabase), me: profile, notify: app.notify });
    await admin.refresh();
  });
  $('adminNav').hidden = profile.role !== 'admin';

  // Coming back to the tab: pick up changes from other devices, and deactivation.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void app.refresh().catch(() => {});
  });

  offerLocalImport(repo, app, session.user.id);
}

function showAccount(profile: Profile): void {
  $('who').textContent = profile.displayName || profile.email;
  $('acctEmail').textContent = profile.email;
  $('acctRole').textContent = profile.role === 'admin' ? 'Admin' : 'Member';
  $('acctRole').className = `badge ${profile.role === 'admin' ? 'admin' : ''}`;
}

function setupViews(onOpen: (view: View) => Promise<void>): void {
  const ids: Record<View, string> = { dashboard: 'viewDashboard', settings: 'viewSettings', admin: 'viewAdmin' };
  $('views').addEventListener('click', (e) => {
    const view = (e.target as HTMLElement).dataset.view as View | undefined;
    if (!view) return;
    for (const v of VIEWS) $(ids[v]).hidden = v !== view;
    document.querySelectorAll<HTMLElement>('#views button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    void onOpen(view);
  });
}

/** Offer to upload data saved in this browser before accounts existed. */
function offerLocalImport(repo: SupabaseRepository, app: AppHandle, userId: string): void {
  const local = new LegacyLocalStore();
  if (!local.hasData()) return;

  const settingsButton = $('localImportSettings');
  settingsButton.hidden = false;
  if (!local.wasImportedBy(userId)) {
    const n = local.transactionCount;
    $('localImportText').textContent =
      `This browser has ${n} transaction${n === 1 ? '' : 's'} saved from before you had an account. ` +
      'Import them into your account to see them on all your devices. Anything already in your account is skipped, so it is safe to do more than once.';
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
      app.notify(`Import failed: ${(e as Error).message}. Nothing was changed; try again.`);
    } finally {
      (button as HTMLButtonElement).disabled = false;
    }
  };
  $('localImportBtn').addEventListener('click', (e) => void run(e.currentTarget as HTMLElement));
  settingsButton.addEventListener('click', (e) => void run(e.currentTarget as HTMLElement));
  $('localImportLater').addEventListener('click', () => ($('localImport').hidden = true));
}

main();
