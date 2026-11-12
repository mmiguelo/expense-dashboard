/** The currency amounts are shown in: the user's, set once the profile is loaded. */
let shownCurrency = 'EUR';

export function setCurrency(code: string): void {
  shownCurrency = code;
}

/** The currency's symbol on its own, e.g. "€" or "US$". */
export const currencySymbol = (code = shownCurrency): string =>
  new Intl.NumberFormat('pt-PT', { style: 'currency', currency: code }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? code;

/** An amount in the user's currency. (Named for when it was always euros.) */
export const formatEur = (n: number): string => n.toLocaleString('pt-PT', { style: 'currency', currency: shownCurrency });

/** Currencies offered at sign-up and in "My account". */
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'BRL', 'CAD', 'AUD', 'JPY', 'CNY', 'INR', 'MXN', 'ZAR', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'AOA', 'MZN', 'CVE'];

/** Accepts both "12,50" and "12.50". Returns NaN for invalid input. */
export const parseAmount = (s: string | number): number => parseFloat(String(s).replace(',', '.'));

/** Amount as typed in the form: decimal comma. */
export const amountToInput = (n: number): string => String(n).replace('.', ',');

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export const escapeHtml = (s: unknown): string => String(s).replace(/[&<>"]/g, (c) => ESCAPES[c]!);
