import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig } from '../config';

/**
 * Browser client: keeps the session (in browser storage, managed by supabase-js) so
 * users stay signed in, and picks up the session from password-reset links.
 */
export const createSupabaseClient = ({ url, anonKey }: SupabaseConfig): SupabaseClient =>
  createClient(url, anonKey, {
    // Implicit flow: a password-reset link works even when opened on another device.
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
