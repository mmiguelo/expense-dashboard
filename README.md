# Expense Dashboard

A personal expense dashboard: expenses and income, categories with budgets, recurring expenses, comparisons with the previous period, projections, charts and backups. Data is stored in [Supabase](https://supabase.com) behind an email + password account, so it syncs across devices.

Live at **https://mmiguelo.github.io/expense-dashboard/**

Built with [Vite](https://vite.dev) and TypeScript, with no UI framework. Tests use [Vitest](https://vitest.dev).

## Your data

Each user's data lives in their own rows in Postgres. Row Level Security on every table means a signed-in user can only read and change rows where `user_id` is their own id, and signed-out visitors can read nothing. The signed-out screen shows no data.

Data saved in a browser before accounts existed (localStorage keys `exp-v2` and `expenses-v1`) stays in that browser. After signing in, the app offers **Import my existing local data**. It's also under **Settings → Backup**. Importing again, or from a second device with the same data, skips everything already in the account. **Add JSON backup** does the same for an exported backup file, and **Import JSON** replaces your data with the backup.

## Development

Requires Node.js 22 or later, and Docker for the local Supabase.

```bash
npm install        # once, after cloning
npm run db:start   # local Supabase in Docker, with the migrations applied
cp .env.example .env.local   # then fill in the values below
npm run dev        # dev server with live reload at http://localhost:5173
```

For the local Supabase, put these in `.env.local`. The values come from `npx supabase status`: `API_URL` and `PUBLISHABLE_KEY`.

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

Locally, accounts don't need email confirmation. Emails (password resets) are caught by Mailpit at http://127.0.0.1:54334.

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (no database needed) |
| `npm run test:db` | Database, RLS and end-to-end tests; needs `SUPABASE_TEST_URL` and `SUPABASE_TEST_ANON_KEY` (see below) |
| `npm run build` | Type-check and build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run db:start` / `db:stop` | Start / stop the local Supabase |
| `npm run db:reset` | Recreate the local database from the migrations (deletes local data) |

```bash
eval "$(npx supabase status -o env | grep -E '^(API_URL|PUBLISHABLE_KEY)=')"
SUPABASE_TEST_URL=$API_URL SUPABASE_TEST_ANON_KEY=$PUBLISHABLE_KEY npm run test:db
```

### Changing the database

Add a new file to `supabase/migrations/` (`npx supabase migration new <name>`), and never edit one that has already been applied. Test it locally with `npm run db:reset`, then apply it to the hosted project with `npx supabase db push`.

## Deployment

Pushing to `main` deploys. The workflow in `.github/workflows/deploy.yml`:

1. Starts a throwaway Supabase, applies the migrations, and runs the database and RLS tests.
2. Runs the unit tests and builds with the `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` repository variables.
3. Publishes `dist/` to GitHub Pages.

If any step fails, or the variables aren't set, nothing is published and the live site stays as it was.

```bash
git add -A
git commit -m "Describe your change"
git push
gh run watch        # optional: follow the deploy
```

Database changes are not deployed by the workflow. Run `npx supabase db push` yourself before pushing code that depends on them.

## One-time Supabase setup

1. **Create a project** at https://supabase.com/dashboard → **New project**. Pick a region near you and save the database password.
2. **Apply the schema** from this folder:
   ```bash
   npx supabase login                               # opens the browser
   npx supabase link --project-ref <project-ref>    # the ref is in the project URL; asks for the DB password
   npx supabase db push                             # applies supabase/migrations
   ```
   Without the CLI, you can instead paste each file in `supabase/migrations/`, oldest first, into the dashboard's **SQL Editor** and run it.
3. **Auth URLs**: go to **Authentication → URL Configuration**.
   - Site URL: `https://mmiguelo.github.io/expense-dashboard/`
   - Redirect URLs: add `https://mmiguelo.github.io/expense-dashboard/**` and `http://localhost:5173/**`
4. **Email sign-in**: go to **Authentication → Sign In / Providers → Email**. Keep Email enabled and **Confirm email** on. Set the minimum password length to 8 to match the app. Supabase's built-in email sender only sends a few emails per hour, so for more than personal use, set up custom SMTP under **Authentication → Emails**.
5. **Keys**: go to **Project Settings → API Keys**. Copy the Project URL and the **publishable** key (or the legacy **anon** key). Never use the secret / service_role key in this app.
6. **Hosting variables**, so the deployed site can reach Supabase:
   ```bash
   gh variable set VITE_SUPABASE_URL --body "https://<project-ref>.supabase.co"
   gh variable set VITE_SUPABASE_ANON_KEY --body "<publishable or anon key>"
   ```
   These are public values: they end up in the JavaScript sent to every visitor, and RLS is what protects the data. That's why they are repository variables rather than secrets.

## Project structure

```
index.html                   page markup: sign-in screens and the dashboard
src/
  main.ts                    entry point: auth state, which screen to show, local data import
  config.ts                  reads the Supabase URL and key; refuses secret keys
  styles.css
  types.ts                   data types
  categories.ts              default categories, colours, keyword-based category guessing
  recurring.ts               generating monthly transactions from recurring expenses
  analytics.ts               totals, budgets, comparisons, projections, chart data
  backup.ts                  CSV export, JSON backup parsing
  dates.ts, format.ts        date and number helpers
  storage/
    repository.ts            Repository interface: the only way to read or write data
    supabaseRepository.ts    the Supabase implementation (used when signed in)
    supabaseClient.ts        Supabase client setup
    localStorageRepository.ts  reads data saved before accounts, for the one-time import
  ui/
    auth.ts                  sign in, sign up, password reset screens
    render.ts                HTML for each part of the dashboard
    app.ts                   dashboard state, events, and wiring
supabase/
  config.toml                local Supabase settings
  migrations/                schema, RLS policies and database functions
tests/                       Vitest tests (*.integration.test.ts need a database)
expense-dashboard-v2.html    the original single-file app, kept for reference
```

## How it stays consistent

- **Recurring expenses are generated once per month, even with several devices open.** Each generated month is a row in `recurring_occurrences`, with primary key `(recurring_id, month)`. The `add_recurring_occurrences` function inserts the month and its transaction in one database transaction and skips months that already exist. Deleting a generated expense keeps its month row, so it doesn't come back.
- **Imports don't create duplicates.** An imported row keeps its original id in `source_id`, and a unique index on `(user_id, coalesce(source_id, id))` makes `import_snapshot` skip rows the account already has. The import runs in a single database transaction, so it either fully succeeds or changes nothing.

## Tests

- `recurring.test.ts` and `analytics.test.ts` cover the calculations, including month ends (day 31 in a 30-day month, February in leap years).
- `localStorageRepository.test.ts` covers reading old local data, merge imports, and the rule that only `src/storage` touches localStorage.
- `supabaseMapping.test.ts` covers row mapping, the import payload, and the config checks.
- `supabase.integration.test.ts` runs against a real Supabase. It covers the repository, paging, recurring generation from two devices at once, imports, and two users trying to read or change each other's rows.
- `ui.integration.test.ts` drives the real page in jsdom: signed-out screen, sign-up, adding an expense, the local import, and a second user.
