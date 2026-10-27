# Expense Dashboard

A personal expense dashboard: expenses and income, categories with budgets, recurring expenses, comparisons with the previous period, projections, charts and backups. No backend: everything you enter is saved in your browser's `localStorage`.

Live at **https://mmiguelo.github.io/expense-dashboard/**

Built with [Vite](https://vite.dev) and TypeScript, with no UI framework. Tests use [Vitest](https://vitest.dev).

## Your data

Data stays in the browser where you entered it. It is not uploaded anywhere, and it doesn't sync between devices or browsers. Clearing your site data for the page deletes it, so export a backup from **Settings** now and then.

## Development

Requires Node.js 22 or later.

```bash
npm install        # once, after cloning
npm run dev        # dev server with live reload at http://localhost:5173
npm test           # run the tests once
npm run test:watch # re-run tests on every change
npm run build      # type-check and build the site into dist/
npm run preview    # serve the built dist/ locally to check it
```

## Deployment

Pushing to `main` deploys. A GitHub Actions workflow (`.github/workflows/deploy.yml`) installs dependencies, runs the tests, builds, and publishes `dist/` to GitHub Pages. If the tests fail, nothing is published and the live site stays as it was.

```bash
git add -A
git commit -m "Describe your change"
git push
```

The site updates a minute or two after the push. Watch progress with `gh run watch`, or under the repository's **Actions** tab. To redeploy without changes, run `gh workflow run deploy.yml`.

## Project structure

```
index.html                   page markup; loads src/main.ts
src/
  main.ts                    entry point: picks the storage and starts the app
  styles.css
  types.ts                   data types (field names match the stored format)
  categories.ts              default categories, colours, keyword-based category guessing
  recurring.ts               generating monthly transactions from recurring expenses
  analytics.ts               totals, budgets, comparisons, projections, chart data
  backup.ts                  CSV export, JSON backup parsing
  dates.ts, format.ts        date and number helpers
  storage/
    repository.ts            Repository interface: the only way to read or write data
    localStorageRepository.ts  the localStorage implementation
  ui/
    render.ts                HTML for each part of the page
    app.ts                   state, events, and wiring
tests/                       Vitest tests
expense-dashboard-v2.html    the original single-file app, used by the parity test
```

## Storage

All data access goes through the `Repository` interface in `src/storage/repository.ts`. Nothing else touches `localStorage`, and a test enforces this. To move to a database, write another class that implements `Repository` and pass it to `startApp` in `src/main.ts`.

The localStorage implementation stores everything as JSON under the key `exp-v2`. If that key is missing, it reads data from the older `expenses-v1` key. The JSON backup format is the same as the stored format, so old backups still import.

## Tests

- `recurring.test.ts` and `analytics.test.ts` cover the calculations, including month ends (day 31 in a 30-day month, February in leap years).
- `localStorageRepository.test.ts` covers storage, the old keys, and the localStorage boundary.
- `parity.test.ts` runs the original app (`expense-dashboard-v2.html`) and the new one side by side in jsdom, and checks they render, store and export the same. Delete it, together with `expense-dashboard-v2.html`, once you change the UI on purpose.
