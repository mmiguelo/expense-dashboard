// Per-browser preferences, kept in localStorage. Blocked storage (private mode, policies)
// just means the preference isn't remembered.

const LANGUAGE_KEY = 'lang';

export function savedLanguage(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_KEY);
  } catch {
    return null;
  }
}

export function saveLanguage(lang: string): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    // Not remembered; it still applies until reload.
  }
}

/**
 * The same as savedLanguage(), as a JavaScript expression for pages that can't load the
 * app's code (the generated 404 page).
 */
export const SAVED_LANGUAGE_JS = `(function () { try { return localStorage.getItem(${JSON.stringify(LANGUAGE_KEY)}); } catch (e) { return null; } })()`;

const SIGNED_OUT_KEY = 'signed-out';

/** Remember, for the next page load in this tab only, that the user just logged out. */
export function markSignedOut(): void {
  try {
    sessionStorage.setItem(SIGNED_OUT_KEY, '1');
  } catch {
    // The "signed out" note just isn't shown.
  }
}

/** Whether the user just logged out in this tab; reading it clears it. */
export function takeSignedOut(): boolean {
  try {
    const was = sessionStorage.getItem(SIGNED_OUT_KEY) !== null;
    sessionStorage.removeItem(SIGNED_OUT_KEY);
    return was;
  } catch {
    return false;
  }
}

const FOLDED_KEY = 'folded-sections';

/** Ids of the sections collapsed in this browser; null if never changed here. */
export function foldedSections(): string[] | null {
  try {
    const saved = localStorage.getItem(FOLDED_KEY);
    if (saved === null) return null;
    const v: unknown = JSON.parse(saved);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}

export function saveFoldedSections(ids: string[]): void {
  try {
    localStorage.setItem(FOLDED_KEY, JSON.stringify(ids));
  } catch {
    // Not remembered.
  }
}

const LAST_ACCOUNT_KEY = 'last-account';

/** The account of the last transaction added in this browser, to pre-select it. */
export function lastAccount(): string | null {
  try {
    return localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    return null;
  }
}

export function saveLastAccount(id: string): void {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, id);
  } catch {
    // Not remembered; the first account is pre-selected instead.
  }
}
