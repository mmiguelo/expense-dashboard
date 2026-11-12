import { en } from './en';
import { es } from './es';
import { pt, type MessageKey } from './pt';
import { currencySymbol } from '../format';

// Every text the user sees comes from here. Portuguese is the default; add a language by
// adding a dictionary with the same keys as pt.ts and listing it in LANGUAGES.

export type { MessageKey };

export const LANGUAGES = { pt, en, es } as const;
/** Each language's name, written in that language (shown in the language menu). */
export const LANGUAGE_NAMES: Record<keyof typeof LANGUAGES, string> = { pt: 'Português', en: 'English', es: 'Español' };
export type Lang = keyof typeof LANGUAGES;
export const DEFAULT_LANG: Lang = 'pt';

let current: Lang = DEFAULT_LANG;

export const getLang = (): Lang => current;

export function setLang(lang: Lang): void {
  current = lang;
}

/** Use `saved` (e.g. the language remembered in this browser) if it is a known one. */
export function initLang(saved: string | null | undefined): Lang {
  if (saved && saved in LANGUAGES) current = saved as Lang;
  return current;
}

type Params = Record<string, string | number>;

/** The text for `key` in the current language, with {placeholders} filled in. */
export function t(key: MessageKey, params: Params = {}): string {
  const text: string = LANGUAGES[current][key] ?? pt[key];
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

type PluralBase = { [K in MessageKey]: K extends `${infer B}.one` ? B : never }[MessageKey];

/** `${base}.one` when n is 1, `${base}.other` otherwise; {n} is filled in. */
export const tn = (base: PluralBase, n: number, params: Params = {}): string =>
  t(`${base}.${n === 1 ? 'one' : 'other'}` as MessageKey, { n, ...params });

/** Short month names, January first. */
export const monthNames = (): string[] => t('months').split(',');

/**
 * Translate the static page: data-i18n sets the text, data-i18n-placeholder,
 * data-i18n-aria-label and data-i18n-title set those attributes.
 */
export function translatePage(doc: Document): void {
  doc.documentElement.lang = current;
  doc.title = t('page.title');
  const params = { symbol: currencySymbol() };
  doc.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n as MessageKey, params)));
  for (const attr of ['placeholder', 'aria-label', 'title'] as const) {
    doc.querySelectorAll<HTMLElement>(`[data-i18n-${attr}]`).forEach((el) => el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`) as MessageKey, params)));
  }
}

/**
 * Errors the database raises are in English; show the known ones in the current
 * language. Anything else is shown as it came.
 */
export function translateError(message: string): string {
  let m: RegExpMatchArray | null;
  if (/Too many changes at once/.test(message)) return t('db.tooMany');
  if ((m = message.match(/Limit reached: an account can have at most (\d+)/))) return t('db.limit', { n: m[1]! });
  if ((m = message.match(/There is already a category called "(.*)"/))) return t('cat.exists', { name: m[1]! });
  if ((m = message.match(/"(.*)" is still used by transactions/))) return t('db.stillUsed', { name: m[1]! });
  if (/cannot be renamed|cannot be deleted/.test(message)) return t('db.incomeReserved');
  if (/Choose another name/.test(message)) return t('db.chooseAnotherName');
  if (/account is not active/.test(message)) return t('db.notActive');
  if (/too large to import/.test(message)) return t('db.tooLarge');
  if (/at least one active admin/.test(message)) return t('admin.err.lastAdmin');
  if (/owner account cannot/.test(message)) return t('admin.err.owner');
  if (/only the owner can/.test(message)) return t('admin.err.ownerOnly');
  if (/own role/.test(message)) return t('admin.err.ownRole');
  if (/deactivate your own/.test(message)) return t('admin.err.ownDeactivate');
  if (/This is your last (expense|income) category/.test(message)) return t('cat.lastOfKind');
  if (/currency cannot change/.test(message)) return t('account.currencyLocked');
  if (/Archive it instead/.test(message)) return t('acc.blocked.transfers');
  if (/at least one open account/.test(message)) return t('acc.blocked.last');
  if (/duplicate key/.test(message)) return t('db.duplicate');
  return message;
}
