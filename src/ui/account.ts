import type { SupabaseClient } from '@supabase/supabase-js';
import { t, translateError } from '../i18n';
import type { Repository } from '../storage/repository';
import type { Profile } from '../types';
import { friendly } from './auth';
import { currencyOptions } from './render';

// "A minha conta": the signed-in user's name, currency and password, and deleting their data.

export interface AccountOptions {
  doc: Document;
  supabase: SupabaseClient;
  repo: Repository;
  profile: Profile;
  notify(message: string): void;
  /** After the name changes, so the menu can show it. */
  onNameChanged(name: string): void;
  /** Whether there are transactions, which lock the currency. */
  hasEntries(): boolean;
  /** After the currency changes: everything is drawn again in it. */
  onCurrencyChanged(): void;
  /** After all data was deleted: start again from a fresh load. */
  onDataDeleted(): void;
  /** After the account was deleted: sign out and go back to the landing page. */
  onAccountDeleted(): void;
}

export function setupAccount(options: AccountOptions): void {
  const { doc, supabase, repo, profile, notify, onNameChanged, hasEntries, onCurrencyChanged } = options;
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => doc.getElementById(id) as T;
  $('acctName').value = profile.displayName;
  $('acctEmailField').value = profile.email;

  // The currency: free to change only while there are no entries.
  const currency = $<HTMLSelectElement>('acctCurrency');
  currency.innerHTML = currencyOptions(profile.currency);
  const lock = () => {
    currency.disabled = hasEntries();
    $('acctCurrencyHelp').textContent = t(currency.disabled ? 'account.currencyLocked' : 'account.currencyHelp');
  };
  lock();
  doc.querySelector('[data-view="account"]')?.addEventListener('click', lock);
  currency.addEventListener('change', async () => {
    try {
      await repo.updateCurrency(currency.value);
      notify(t('account.currencySaved'));
      onCurrencyChanged();
    } catch (err) {
      currency.value = profile.currency;
      notify(translateError((err as Error).message));
      lock();
    }
  });

  $<HTMLFormElement>('nameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('acctName').value.trim();
    try {
      await repo.updateDisplayName(name);
      onNameChanged(name);
      notify(t('account.nameSaved'));
    } catch (err) {
      notify(translateError((err as Error).message));
    }
  });

  const msg = (text: string, kind: 'err' | 'ok' | '' = '') => {
    $('pwMsg').textContent = text;
    $('pwMsg').className = `authmsg ${kind}`;
  };
  const button = $<HTMLFormElement>('pwForm').querySelector<HTMLButtonElement>('button[type="submit"]')!;

  $<HTMLFormElement>('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('pwNew').value;
    if (password.length < 8) return msg(t('auth.passwordShort'), 'err');
    if (password !== $('pwConfirm').value) return msg(t('account.passwordMismatch'), 'err');
    button.disabled = true;
    msg('');
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      $('pwNew').value = '';
      $('pwConfirm').value = '';
      msg(t('account.passwordChanged'), 'ok');
    } catch (err) {
      const m = `${(err as { code?: string }).code ?? ''} ${(err as Error).message ?? ''}`;
      msg(/same_password|different from the old/i.test(m) ? t('account.samePassword') : friendly(err), 'err');
    } finally {
      button.disabled = false;
    }
  });
  setupDelete(options);
}

/**
 * Deleting all data, or the whole account: both permanent, so both ask for the password
 * (someone else at an unlocked computer can't do it) after saying what will go.
 */
function setupDelete({ doc, supabase, repo, profile, onDataDeleted, onAccountDeleted }: AccountOptions): void {
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => doc.getElementById(id) as T;
  const form = $<HTMLFormElement>('delForm');
  const confirm = $<HTMLButtonElement>('delConfirm');
  let what: 'data' | 'account' = 'data';
  const msg = (text: string, kind: 'err' | 'ok' | '' = '') => {
    $('delMsg').textContent = text;
    $('delMsg').className = `authmsg ${kind}`;
  };
  const open = (w: 'data' | 'account') => {
    what = w;
    $('delWarn').textContent = t(w === 'data' ? 'delete.dataWarn' : 'delete.accountWarn');
    confirm.textContent = t(w === 'data' ? 'delete.dataConfirm' : 'delete.accountConfirm');
    $('delPass').value = '';
    msg('');
    form.hidden = false;
    $('delPass').focus();
  };
  $('delDataBtn').addEventListener('click', () => open('data'));
  $('delAcctBtn').addEventListener('click', () => open('account'));
  $('delCancel').addEventListener('click', () => {
    form.hidden = true;
    msg('');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('delPass').value;
    if (!password) return msg(t('delete.needPassword'), 'err');
    confirm.disabled = true;
    msg('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: profile.email, password });
      if (error) throw error;
      if (what === 'data') {
        await repo.deleteMyData();
        onDataDeleted();
      } else {
        await repo.deleteMyAccount();
        onAccountDeleted();
      }
    } catch (err) {
      const m = (err as Error)?.message ?? '';
      msg(/invalid login credentials|invalid_credentials/i.test(`${(err as { code?: string }).code} ${m}`) ? t('delete.wrongPassword') : /owner|admin/.test(m) ? translateError(m) : friendly(err), 'err');
    } finally {
      confirm.disabled = false;
    }
  });
}
