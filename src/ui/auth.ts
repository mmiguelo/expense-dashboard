import type { SupabaseClient } from '@supabase/supabase-js';

type AuthMode = 'signin' | 'signup' | 'reset';

const COPY: Record<AuthMode, { intro: string; submit: string; switchTo: string; password: boolean }> = {
  signin: { intro: 'Sign in to see your expenses on any device.', submit: 'Sign in', switchTo: 'Create an account', password: true },
  signup: { intro: 'Create an account. Use at least 8 characters for the password.', submit: 'Create account', switchTo: 'I already have an account', password: true },
  reset: { intro: "Enter your email and we'll send you a link to choose a new password.", submit: 'Send reset link', switchTo: 'Back to sign in', password: false },
};

/** Where Supabase sends people back to from emails: this page, without any hash. */
const pageUrl = (doc: Document) => doc.location.href.split('#')[0]!.split('?')[0]!;

/**
 * Wire the signed-out screen: sign in, create an account, or request a password reset.
 * Signing in is picked up by the auth state listener in main.ts.
 */
export function setupAuthScreen(doc: Document, supabase: SupabaseClient): void {
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => doc.getElementById(id) as T;
  let mode: AuthMode = 'signin';

  const message = (text: string, kind: 'err' | 'ok' | '' = '') => {
    $('authMsg').textContent = text;
    $('authMsg').className = `authmsg ${kind}`;
  };

  const setMode = (m: AuthMode) => {
    mode = m;
    const c = COPY[m];
    $('authIntro').textContent = c.intro;
    $('authSubmit').textContent = c.submit;
    $('authSwitch').textContent = c.switchTo;
    $('authPassLabel').hidden = !c.password;
    $('authPass').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    $('authForgot').hidden = m !== 'signin';
    message('');
  };

  $('authSwitch').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
  $('authForgot').addEventListener('click', () => setMode('reset'));

  $<HTMLFormElement>('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('authEmail').value.trim();
    const password = $('authPass').value;
    if (!email.includes('@')) return message('Enter your email address.', 'err');
    if (COPY[mode].password && password.length < 8) return message('The password needs at least 8 characters.', 'err');

    const button = $<HTMLButtonElement>('authSubmit');
    button.disabled = true;
    message('');
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: pageUrl(doc) } });
        if (error) throw error;
        // With email confirmation on, there's no session until the link is clicked.
        if (!data.session) message(`Almost done: open the link we sent to ${email} to confirm your account, then sign in.`, 'ok');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: pageUrl(doc) });
        if (error) throw error;
        message(`If ${email} has an account, a reset link is on its way.`, 'ok');
      }
    } catch (err) {
      message(friendly(err), 'err');
    } finally {
      button.disabled = false;
    }
  });

  setMode('signin');
}

/** The form shown after following a password-reset link. */
export function setupRecoveryScreen(doc: Document, supabase: SupabaseClient, onDone: () => void): void {
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => doc.getElementById(id) as T;
  $<HTMLFormElement>('recoveryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('newPass').value;
    const msg = $('recoveryMsg');
    if (password.length < 8) {
      msg.textContent = 'The password needs at least 8 characters.';
      msg.className = 'authmsg err';
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      msg.textContent = friendly(error);
      msg.className = 'authmsg err';
      return;
    }
    doc.defaultView!.history.replaceState(null, '', pageUrl(doc));
    onDone();
  });
}

function friendly(err: unknown): string {
  const m = (err as { message?: string })?.message ?? String(err);
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first: open the link we sent you.';
  if (/already registered/i.test(m)) return 'There is already an account with this email. Sign in instead.';
  if (/rate limit/i.test(m)) return 'Too many attempts. Wait a few minutes and try again.';
  if (/failed to fetch|network/i.test(m)) return "Can't reach the server. Check your connection.";
  return m;
}
