import type { Session, SupabaseClient } from '@supabase/supabase-js';
import './styles.css';
import { readSupabaseConfig } from './config';
import { LocalStorageRepository } from './storage/localStorageRepository';
import { createSupabaseClient } from './storage/supabaseClient';
import { SupabaseRepository } from './storage/supabaseRepository';
import { setupAuthScreen, setupRecoveryScreen } from './ui/auth';
import { importMessage, startApp, type AppHandle } from './ui/app';

const SCREENS = ['loading', 'configError', 'auth', 'recovery', 'app'] as const;
type Screen = (typeof SCREENS)[number];

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
  let app: Promise<AppHandle> | null = null;
  // Arriving from a password-reset email.
  let recovering = /type=recovery/.test(location.hash);

  setupRecoveryScreen(document, supabase, () => {
    recovering = false;
    void supabase.auth.getSession().then(({ data }) => onSession(data.session));
  });

  function onSession(session: Session | null): void {
    if (recovering) return show('recovery');
    if (session) {
      app ??= startSignedIn(supabase, session).catch((e) => {
        $('configMsg').textContent = `Couldn't load your data: ${(e as Error).message}. Reload the page to try again.`;
        show('configError');
        throw e;
      });
      show('app');
    } else if (app) {
      // Signed out (here or in another tab) or the session ended: drop everything in memory.
      location.reload();
    } else show('auth');
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') recovering = true;
    // Supabase advises against calling it from inside this callback; defer.
    setTimeout(() => onSession(session), 0);
  });

  $('logout').addEventListener('click', async () => {
    await supabase.auth.signOut({ scope: 'local' });
    location.reload();
  });
}

async function startSignedIn(supabase: SupabaseClient, session: Session): Promise<AppHandle> {
  $('who').textContent = session.user.email ?? '';
  const repo = new SupabaseRepository(supabase);
  try {
    await repo.initialize();
  } catch (e) {
    console.error(e);
  }
  const app = await startApp({ doc: document, repo });
  offerLocalImport(repo, app, session.user.id);
  return app;
}

/** Offer to upload data saved in this browser before accounts existed. */
function offerLocalImport(repo: SupabaseRepository, app: AppHandle, userId: string): void {
  const local = new LocalStorageRepository();
  if (!local.hasData()) return;

  const settingsButton = $('localImportSettings');
  settingsButton.hidden = false;
  if (!local.wasImportedBy(userId)) {
    void local.listTransactions().then((txs) => {
      $('localImportText').textContent =
        `This browser has ${txs.length} transaction${txs.length === 1 ? '' : 's'} saved from before you had an account. ` +
        'Import them into your account to see them on all your devices. Anything already in your account is skipped, so it is safe to do more than once.';
      $('localImport').hidden = false;
    });
  }

  const run = async (button: HTMLElement) => {
    (button as HTMLButtonElement).disabled = true;
    try {
      const result = await repo.importSnapshot(await local.exportSnapshot(), { replace: false });
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
