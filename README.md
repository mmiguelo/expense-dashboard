# Expense Dashboard

A personal expense dashboard for several people: each account has its own private expenses and income, categories, auto-categorization rules, budgets and recurring expenses, synced across devices. Built on [Supabase](https://supabase.com) (email + password accounts, Postgres with Row Level Security).

Live at **https://mmiguelo.github.io/expense-dashboard/**

Built with [Vite](https://vite.dev) and TypeScript, with no UI framework. Tests use [Vitest](https://vitest.dev) and [pgTAP](https://pgtap.org).

## Accounts and roles

- **Anyone can create an account** with email and password. The email must be confirmed before the account can sign in or reach any data.
- **Every new account is a `member`.** It starts with a copy of the default categories, subcategories and keyword rules, then they are its own to change.
- **Admins** get an **Admin** screen with two tabs. **Users** lists accounts (email, name, role, status, created date) and lets admins change roles and deactivate or reactivate accounts. **Defaults** sets the categories, colours and keyword rules that new accounts start with. Admins see account details only. They cannot read anyone's transactions, categories, rules, budgets or recurring expenses: the database doesn't allow it.
- **The owner** is one protected admin. Nobody can demote, deactivate or delete the owner, and **only the owner can demote or deactivate other admins**. Other admins can promote members to admin and deactivate or reactivate members. The owner is marked by hand in the SQL Editor (see below) and can't be changed through the app.
- **Deactivating** an account blocks it immediately, even if it is signed in, and deletes nothing. Reactivating restores everything. Nobody can change their own role or deactivate themselves, and the last active admin can't be demoted, deactivated or deleted.

### Making the first admin

New accounts are always members, so make yourself admin and owner once, by hand:

1. Create your account on the site and confirm your email.
2. In the Supabase dashboard, open **SQL Editor**, run this with your email, and check it reports 1 row:
   ```sql
   update public.profiles set role = 'admin', owner = true where email = 'you@example.com';
   ```
   This also makes you the owner. To hand ownership to another admin later, run `update public.profiles set owner = false where owner;` and then set `owner = true` on theirs.
3. Reload the site. The account menu now says **Admin**, and the **Admin** tab appears.

After that, make other admins from the Admin screen.

## How the data is protected

Everything is enforced in Postgres, so it holds for any client, not just this app:

- **Row Level Security on every table.** Financial tables (`transactions`, `categories`, `keyword_rules`, `budgets`, `recurring_expenses`, `recurring_occurrences`, `category_corrections`) allow a row only when `user_id = auth.uid()` **and** `is_active_user()`. That second function checks that the account exists, is active and has a confirmed email, so deactivation applies to the very next request. No policy mentions admins, so admins have no extra access to these tables.
- **`profiles`:** members read only their own row. Admins (`is_admin()`) read and update all rows. A trigger enforces which columns may change: only admins may change `role` or `active`, nobody may change their own, and there must always be one active admin. A lock prevents two admins from demoting each other at the same moment.
- **`default_categories` and `default_keyword_rules`:** readable by active users, writable by admins.
- **Signed-out requests** (the public anon key with no login) get no access to anything.
- **Write limits** stop one account from flooding the database. They are checked once per insert statement:

  | Limit | Value |
  |---|---|
  | New rows per account per minute, all tables together | 120 |
  | Transactions per account | 50,000 |
  | Generated recurring months | 20,000 |
  | Learned merchants | 5,000 |
  | Keyword rules | 2,000 |
  | Categories, budgets, recurring expenses | 200 each |
  | Transactions per import | 20,000 |

  Imports and recurring generation don't count towards the per-minute limit, but they stay within the per-table maximums. The limits live in `supabase/migrations/20261028090200_write_limits_and_category_functions.sql`.
- **No service role key** in the app, the tests, or CI. The browser only ever has the public URL and publishable key.

## Using it

- **Dashboard:** add expenses and income, each with a category and optionally a subcategory. The description suggests a category from your keyword rules, and a subcategory when it names one ("Netflix" → Subscrições › Netflix). Income always goes in **Rendimentos** (Salário, Vendas, ...). You also get charts, budgets per category, comparisons with the previous period and projections.
- **Settings:**
  - Categories: add, rename, recolor, or delete, choosing where to move what still uses the category. Renaming or deleting updates transactions, recurring expenses, rules and budgets in one transaction. Open a category to add or delete its subcategories; deleting one leaves its transactions in the category without a subcategory. **Rendimentos** is reserved for income and can't be renamed or deleted.
  - Keyword rules, monthly budgets, recurring expenses, and backups (JSON/CSV export, JSON import).
- **Account menu** (top right): your email and role, and **Log out**.
- **Language:** the interface is in Portuguese. All texts live in `src/i18n/` (`pt.ts` is the reference, `en.ts` has the same keys); a language picker can switch between them with `setLang` and remember the choice with `saveLanguage`.
- **Old browser data:** data saved in a browser before accounts existed (`exp-v2` / `expenses-v1`) can be imported once with **Import my existing local data**. Importing again skips anything already there.

## Development

Requires Node.js 22 or later, and Docker for the local Supabase.

```bash
npm install
npm run db:start             # local Supabase with all migrations
cp .env.example .env.local   # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from `npx supabase status`
npm run dev                  # http://localhost:5173
```

Locally, confirmation and password-reset emails go to Mailpit at http://127.0.0.1:54334: open the link there to confirm an account. To get an admin locally, run the SQL above with `docker exec -it supabase_db_expenseDashboard psql -U postgres`.

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (no database needed) |
| `npm run test:rls` | pgTAP tests of RLS, roles, deactivation, limits (`supabase/tests/`) |
| `npm run test:db` | API and end-to-end tests against the local Supabase (needs the variables below) |
| `npm run check:security` | Plain-HTTP checks of who can see what, against the local Supabase only |
| `npm run build` | Type-check and build into `dist/` |
| `npm run db:reset` | Recreate the local database from the migrations (deletes local data) |

```bash
eval "$(npx supabase status -o env | grep -E '^(API_URL|PUBLISHABLE_KEY|DB_URL)=')"
SUPABASE_TEST_URL=$API_URL SUPABASE_TEST_ANON_KEY=$PUBLISHABLE_KEY SUPABASE_TEST_DB_URL=$DB_URL npm run test:db
```

`supabase/config.toml` only configures the **local** Supabase. Its rate limits are deliberately high, because the tests sign up many users from one IP. The hosted project's settings are made in its dashboard (below).

### Changing the database

Add a new migration (`npx supabase migration new <name>`); never edit one that has been applied. Check it with `npm run db:reset` and the tests, then apply it to the hosted project with `npx supabase db push` **before** pushing code that depends on it.

## Deployment

Pushing to `main` deploys (`.github/workflows/deploy.yml`):

1. **Database tests:** a throwaway Supabase runs the pgTAP tests, the API and end-to-end tests, and the security check.
2. **Build:** unit tests, then a build with the `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` repository variables.
3. **Publish** to GitHub Pages.

If anything fails, nothing is published. Migrations are not applied by the workflow; run `npx supabase db push` yourself.

## Supabase dashboard settings (hosted project)

These can't be set from the code. Open https://supabase.com/dashboard → your project.

### 1. Require email confirmation

**Authentication → Sign In / Providers → Email:**
- **Enable Email provider:** on.
- **Confirm email:** on. This is what blocks unconfirmed accounts, and there is no other auto-confirm switch to turn off.
- **Minimum password length:** 8.
- **Secure email change:** on.

On the same page, keep **Allow anonymous sign-ins** off. Also check that no other providers are enabled unless you mean to.

### 2. Site URL and redirect URLs

**Authentication → URL Configuration:**
- **Site URL:** `https://mmiguelo.github.io/expense-dashboard/`
- **Redirect URLs:** `https://mmiguelo.github.io/expense-dashboard/**` and `http://localhost:5173/**`

### 3. Rate limits

**Authentication → Rate Limits.** The email limit can only be changed once custom SMTP is set up (step 4).

| Setting | Value | Why |
|---|---|---|
| Rate limit for sending emails | **30 per hour** | All confirmation, resend and reset emails together, across the project. Enough for family and friends, and it caps the cost of abuse. |
| Rate limit for sign-ups and sign-ins | **30 per 5 minutes per IP** | A household on one connection never gets near it; a script does. |
| Rate limit for token verifications | **30 per 5 minutes per IP** | Opening confirmation and reset links. |
| Rate limit for token refreshes | **150 per 5 minutes per IP** | Keeps sessions alive; leave the default. |
| Anonymous users, SMS, Web3 | leave as is | Not used. |

**Authentication → Emails → SMTP Settings → Minimum interval per user: 60 seconds.** This is the gap between two emails to the same address, which covers resending the confirmation and password resets. It matches the app's 60-second cooldown on those buttons.

The app also disables its buttons after each attempt, with a countdown: sign in 5 s, create account 30 s, resend and reset 60 s, and 60 s whenever Supabase reports a rate limit.

### 4. Custom SMTP (needed for real users)

Supabase's built-in email sends only a few emails per hour, **and only to addresses of your Supabase organization's team members**. Anyone else never receives their confirmation email. Use an email provider:

1. **Choose a provider and verify a sender.**
   - **Resend** (resend.com) or **Postmark** (postmarkapp.com) need a domain you own: add it and create the DNS records they show (SPF, DKIM, and ideally DMARC). That's the most reliable option; a domain costs about €10 a year.
   - **Brevo** (brevo.com) also accepts a single verified sender address without a domain, under **Senders, Domains & Dedicated IPs → Senders**. That works for testing. But a `@gmail.com`, `@hotmail.com` or similar sender sent through Brevo often lands in spam or is rejected by Gmail and Yahoo, because it fails those providers' DMARC checks. Use a domain for real users.
2. **Get the SMTP credentials:**
   - Resend: host `smtp.resend.com`, port `465`, user `resend`, password = an API key.
   - Brevo: **SMTP & API → SMTP**. Host `smtp-relay.brevo.com`, port `587`, login as shown, password = an SMTP key.
   - Postmark: host `smtp.postmarkapp.com`, port `587`, user and password = a server API token.
3. **Enter them in Supabase:** **Authentication → Emails → SMTP Settings → Enable custom SMTP**. Fill in the sender email (your verified address or domain), sender name `Expense Dashboard`, host, port, username, password, and minimum interval 60 seconds. Save. The SMTP password stays in Supabase, never in this repository.
4. **Then raise the email rate limit** to 30 per hour (step 3).
5. **Test with an address outside your team:**
   - Sign up on the live site with an email that is **not** a member of your Supabase organization, such as a second personal address or a friend's.
   - Check that it arrives within a minute (look in spam too), and that the link confirms the account and lets you sign in.
   - Check the provider's logs (Resend: Emails; Brevo: Transactional → Logs) and Supabase's **Logs → Auth** for errors.
   - For a deliverability score, sign up with the one-off address shown on https://www.mail-tester.com and open its report. It should show SPF and DKIM passing.
   - Delete test accounts afterwards: **Authentication → Users**.

### 5. Data API

**Project Settings → Data API:** the Data API is enabled, **Automatically expose new tables** is off (every migration grants access explicitly), and **automatic RLS** is on.

## Project structure

```
index.html                      sign-in, deactivated, dashboard, settings and admin screens
src/
  main.ts                       auth state, screens, account menu, local data import
  config.ts                     reads the Supabase URL and key; refuses secret keys
  types.ts, dates.ts, format.ts
  categories.ts                 colours and category guessing (rules come from the database)
  recurring.ts                  generating monthly transactions from recurring expenses
  analytics.ts                  totals, budgets, comparisons, projections, chart data
  backup.ts                     CSV export, JSON backup parsing
  storage/
    repository.ts               the signed-in user's own data: the only way to read or write it
    supabaseRepository.ts       its Supabase implementation
    adminRepository.ts          accounts and defaults (admins only)
    supabaseAdminRepository.ts  its Supabase implementation
    supabaseClient.ts           Supabase client setup
    legacyLocalStore.ts         reads data saved in the browser before accounts, for import
  ui/
    auth.ts                     sign in / up, reset, resend, with cooldowns
    app.ts                      dashboard and settings
    admin.ts                    admin screen
    render.ts                   HTML builders
supabase/
  config.toml                   local Supabase only
  migrations/                   schema, RLS, functions and limits, in order
  tests/                        pgTAP tests (npm run test:rls)
scripts/security-check.sh       plain-HTTP security checks (local only)
tests/                          Vitest tests (*.integration.test.ts need the local Supabase)
expense-dashboard-v2.html       the original single-file app, kept for reference
```

## Tests

| What | Where |
|---|---|
| A member cannot read or change another member's data | `02_data_access.sql`, `supabase.integration.test.ts`, `ui.integration.test.ts`, `security-check.sh` §1 |
| A member cannot change roles or read other profiles | `01_profiles_roles.sql`, `supabase.integration.test.ts`, `security-check.sh` §2 |
| An admin cannot read a member's transactions (or any of their data) | `02_data_access.sql`, `supabase.integration.test.ts`, `security-check.sh` §3 |
| A deactivated user is locked out of every table, even with a valid session; data kept and restored | `02_data_access.sql`, `supabase.integration.test.ts`, `ui.integration.test.ts`, `security-check.sh` §4 |
| An unconfirmed user cannot sign in or access data | `02_data_access.sql` (even with a token), `supabase.integration.test.ts`, `ui.integration.test.ts`, `security-check.sh` §5 |
| The last active admin cannot be demoted, deactivated or deleted | `01_profiles_roles.sql`, `security-check.sh` §6 |
| Write limits, category rename and delete | `03_limits_and_categories.sql`, `supabase.integration.test.ts` |
| Calculations (month ends, leap years), recurring generation, imports | `analytics.test.ts`, `recurring.test.ts`, `supabase.integration.test.ts` |
