import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

// Helpers for tests that run against a real (local) Supabase:
//   SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY  the API, with the publishable key
//   SUPABASE_TEST_DB_URL                       direct Postgres, for setup only (like the SQL Editor)
//   SUPABASE_TEST_MAILPIT_URL                  the local mail catcher (default http://127.0.0.1:54334)
// Users sign up and confirm their email the real way. The service role key is never used.

export const URL = process.env.SUPABASE_TEST_URL;
export const KEY = process.env.SUPABASE_TEST_ANON_KEY;
const DB_URL = process.env.SUPABASE_TEST_DB_URL;
const MAILPIT = process.env.SUPABASE_TEST_MAILPIT_URL ?? 'http://127.0.0.1:54334';

/** Whether the database tests can run. */
export const HAVE_DB = Boolean(URL && KEY && DB_URL);

export const PASSWORD = 'correct-horse-battery';

export const client = (): SupabaseClient => createClient(URL!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

export const newEmail = (tag = 'user') => `${tag}-${crypto.randomUUID()}@example.test`;

/** Superuser SQL, for test setup (e.g. making the first admin, as the README says). */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  try {
    return (await c.query<T>(text, params)).rows;
  } finally {
    await c.end();
  }
}

/** The confirmation link from the email Supabase sent to `email`. */
async function confirmationLink(email: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages.length) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`)).json()) as { Text: string; HTML: string };
      const link = (msg.Text + msg.HTML).match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/)?.[0];
      if (link) return link.replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No confirmation email for ${email}`);
}

/** Follow the link in the confirmation email, as the user would. */
export async function confirmEmail(email: string): Promise<void> {
  const res = await fetch(await confirmationLink(email), { redirect: 'manual' });
  const location = res.headers.get('location') ?? '';
  if (res.status !== 303 || location.includes('error')) throw new Error(`Confirming ${email} failed: ${res.status} ${location}`);
}

export interface TestUser {
  db: SupabaseClient;
  id: string;
  email: string;
}

/** Sign up without confirming: Supabase gives no session. */
export async function signUpUnconfirmed(email = newEmail()): Promise<{ email: string; session: unknown; id: string }> {
  const { data, error } = await client().auth.signUp({ email, password: PASSWORD });
  if (error) throw error;
  return { email, session: data.session, id: data.user!.id };
}

/** Sign in, as another "device" would. */
export async function signIn(email: string): Promise<SupabaseClient> {
  const db = client();
  const { error } = await db.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return db;
}

/** A new account, confirmed and signed in. */
export async function signUp(tag = 'user'): Promise<TestUser> {
  const { email, id } = await signUpUnconfirmed(newEmail(tag));
  await confirmEmail(email);
  return { db: await signIn(email), id, email };
}

/** A new confirmed account, made admin from SQL as the README describes. */
export async function signUpAdmin(): Promise<TestUser> {
  const user = await signUp('admin');
  await sql(`update public.profiles set role = 'admin' where id = $1`, [user.id]);
  return user;
}
