import type { SupabaseClient } from '@supabase/supabase-js';
import { t, translateError } from '../i18n';
import type { Repository } from '../storage/repository';
import type { Profile } from '../types';
import { friendly } from './auth';

// "A minha conta": the signed-in user's name and password.

export interface AccountOptions {
  doc: Document;
  supabase: SupabaseClient;
  repo: Repository;
  profile: Profile;
  notify(message: string): void;
  /** After the name changes, so the menu can show it. */
  onNameChanged(name: string): void;
}

export function setupAccount({ doc, supabase, repo, profile, notify, onNameChanged }: AccountOptions): void {
  const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => doc.getElementById(id) as T;
  $('acctName').value = profile.displayName;
  $('acctEmailField').value = profile.email;

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
}
