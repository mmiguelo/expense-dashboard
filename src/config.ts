import { t } from './i18n';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/** Role claim of a legacy JWT key, if it is one. */
function jwtRole(key: string): string | undefined {
  try {
    return JSON.parse(atob(key.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).role;
  } catch {
    return undefined;
  }
}

/**
 * Supabase settings from VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Throws with a
 * readable message when they are missing, or when the key is a secret key that must
 * never be shipped to the browser.
 */
export function readSupabaseConfig(env: Record<string, string | undefined> = import.meta.env): SupabaseConfig {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) throw new Error(t('err.config.missing'));
  if (anonKey.startsWith('sb_secret_') || jwtRole(anonKey) === 'service_role')
    throw new Error(t('err.config.secret'));
  return { url, anonKey };
}
