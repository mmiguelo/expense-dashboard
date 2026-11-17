import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { currencyOptions } from './render';

type AuthMode = 'signin' | 'signup' | 'reset';

const COPY: Record<AuthMode, { intro: () => string; submit: () => string; switchTo: () => string; password: boolean }> = {
  signin: { intro: () => t('auth.signin.intro'), submit: () => t('auth.signin.submit'), switchTo: () => t('auth.signin.switch'), password: true },
  signup: { intro: () => t('auth.signup.intro'), submit: () => t('auth.signup.submit'), switchTo: () => t('auth.signup.switch'), password: true },
  reset: { intro: () => t('auth.reset.intro'), submit: () => t('auth.reset.submit'), switchTo: () => t('auth.reset.switch'), password: false },
};

/**
 * Seconds a button stays disabled after each attempt. Supabase limits these per IP
 * address too (Authentication > Rate Limits); this keeps people from running into them.
 */
export const COOLDOWNS = { signin: 5, signup: 30, reset: 60, resend: 60, rateLimited: 60 } as const;

/** Where Supabase sends people back to from emails: this page, without any hash. */
const pageUrl = (doc: Document) => doc.location.href.split('#')[0]!.split('?')[0]!;

type Action = AuthMode | 'resend';

/**
 * Per-action cooldowns: after signing up, signing in is not held back. A button shows
 * the time left on its current action and is disabled until then.
 */
class Cooldowns {
  private until: Partial<Record<Action, number>> = {};
  private timer: number | undefined;
  private views: { button: HTMLButtonElement; action: () => Action; label: () => string }[] = [];

  constructor(private readonly win: Window) {}

  /** Keep `button` in step with the cooldown of `action()`, labelled `label()`. */
  bind(button: HTMLButtonElement, action: () => Action, label: () => string): void {
    this.views.push({ button, action, label });
    this.paint();
  }

  start(action: Action, seconds: number): void {
    this.until[action] = Date.now() + seconds * 1000;
    this.paint();
    this.win.clearInterval(this.timer);
    this.timer = this.win.setInterval(() => this.paint(), 250);
  }

  active(action: Action): boolean {
    return (this.until[action] ?? 0) > Date.now();
  }

  paint(): void {
    let any = false;
    for (const v of this.views) {
      const left = Math.ceil(((this.until[v.action()] ?? 0) - Date.now()) / 1000);
      v.button.disabled = left > 0;
      v.button.textContent = left > 0 ? `${v.label()} (${left}s)` : v.label();
      any ||= left > 0;
    }
    if (!any) this.win.clearInterval(this.timer);
  }
}

const isRateLimited = (err: unknown) => {
  const e = err as { status?: number; code?: string; message?: string };
  return e?.status === 429 || /rate.?limit/i.test(`${e?.code} ${e?.message}`);
};

/**
 * Wire the sign-in form: sign in, create an account, request a password reset, or
 * resend the confirmation email. Signing in is picked up by the auth listener in main.ts.
 * Returns a function that switches the form to another mode.
 */
export function setupAuthScreen(doc: Document, supabase: SupabaseClient): (mode: AuthMode) => void {
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => doc.getElementById(id) as T;
  const submit = $<HTMLButtonElement>('authSubmit');
  const resend = $<HTMLButtonElement>('authResend');
  let mode: AuthMode = 'signin';
  let busy = false;
  const cooldowns = new Cooldowns(doc.defaultView!);
  cooldowns.bind(submit, () => mode, () => COPY[mode].submit());
  cooldowns.bind(resend, () => 'resend', () => t('auth.resend'));

  const message = (text: string, kind: 'err' | 'ok' | '' = '') => {
    $('authMsg').textContent = text;
    $('authMsg').className = `authmsg ${kind}`;
  };
  const offerResend = (show: boolean) => ($('authResendRow').hidden = !show);
  $('authCurrency').innerHTML = currencyOptions();
  fillWithLinks($('authTerms'), t('auth.agree'), { terms: ['./terms.html', t('auth.agreeTerms')], privacy: ['./privacy.html', t('auth.agreePrivacy')] });

  const setMode = (m: AuthMode) => {
    mode = m;
    const c = COPY[m];
    $('authIntro').textContent = c.intro();
    cooldowns.paint();
    $('authSwitch').textContent = c.switchTo();
    $('authPassLabel').hidden = !c.password;
    $('authCurrencyLabel').hidden = m !== 'signup';
    $('authTerms').hidden = m !== 'signup';
    $('authPass').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    $('authForgot').hidden = m !== 'signin';
    message('');
    offerResend(false);
  };

  $('authSwitch').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
  $('authForgot').addEventListener('click', () => setMode('reset'));

  $<HTMLFormElement>('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || cooldowns.active(mode)) return;
    const email = $('authEmail').value.trim();
    const password = $('authPass').value;
    if (!email.includes('@')) return message(t('auth.enterEmail'), 'err');
    if (COPY[mode].password && password.length < 8) return message(t('auth.passwordShort'), 'err');

    const attempt = mode;
    busy = true;
    submit.disabled = true;
    message('');
    offerResend(false);
    let wait: number = COOLDOWNS[attempt];
    try {
      if (attempt === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        wait = 0;
      } else if (attempt === 'signup') {
        const currency = $<HTMLSelectElement>('authCurrency').value;
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: pageUrl(doc), data: { currency } } });
        if (error) throw error;
        // Email confirmation is required, so there is no session until the link is opened.
        if (!data.session) {
          message(t('auth.confirmSent', { email }), 'ok');
          offerResend(true);
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: pageUrl(doc) });
        if (error) throw error;
        message(t('auth.resetSent', { email }), 'ok');
      }
    } catch (err) {
      if (isRateLimited(err)) wait = COOLDOWNS.rateLimited;
      message(friendly(err), 'err');
      offerResend(/not confirmed/i.test((err as Error)?.message ?? ''));
    } finally {
      busy = false;
      if (wait) cooldowns.start(attempt, wait);
      else cooldowns.paint();
    }
  });

  resend.addEventListener('click', async () => {
    if (cooldowns.active('resend')) return;
    const email = $('authEmail').value.trim();
    if (!email.includes('@')) return message(t('auth.enterEmail'), 'err');
    resend.disabled = true;
    let wait: number = COOLDOWNS.resend;
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: pageUrl(doc) } });
      if (error) throw error;
      message(t('auth.resent', { email }), 'ok');
    } catch (err) {
      if (isRateLimited(err)) wait = COOLDOWNS.rateLimited;
      message(friendly(err), 'err');
    } finally {
      cooldowns.start('resend', wait);
    }
  });

  setMode('signin');
  return setMode;
}

/**
 * Set `el` to `text`, with each {name} placeholder made a link from `links` (opening in a
 * new tab, so a half-filled form isn't lost).
 */
export function fillWithLinks(el: HTMLElement, text: string, links: Record<string, [href: string, label: string]>): void {
  const doc = el.ownerDocument;
  el.replaceChildren();
  for (const part of text.split(/(\{\w+\})/)) {
    const link = links[part.slice(1, -1)];
    if (!link) {
      el.append(part);
      continue;
    }
    const a = doc.createElement('a');
    a.href = link[0];
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = link[1];
    el.append(a);
  }
}

/** The form shown after following a password-reset link. */
export function setupRecoveryScreen(doc: Document, supabase: SupabaseClient, onDone: () => void): void {
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => doc.getElementById(id) as T;
  $<HTMLFormElement>('recoveryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('newPass').value;
    const msg = $('recoveryMsg');
    if (password.length < 8) {
      msg.textContent = t('auth.passwordShort');
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

export function friendly(err: unknown): string {
  const e = err as { message?: string; code?: string };
  const m = `${e?.code ?? ''} ${e?.message ?? String(err)}`;
  if (/over_email_send_rate_limit|email rate limit/i.test(m))
    return t('auth.err.emailRate');
  if (isRateLimited(err)) return t('auth.err.rate');
  if (/invalid login credentials|invalid_credentials/i.test(m)) return t('auth.err.credentials');
  if (/email not confirmed|email_not_confirmed/i.test(m)) return t('auth.err.notConfirmed');
  if (/already registered|user_already_exists/i.test(m)) return t('auth.err.exists');
  if (/weak_password|password should/i.test(m)) return t('auth.err.weak');
  if (/failed to fetch|network/i.test(m)) return t('auth.err.network');
  return e?.message ?? String(err);
}
