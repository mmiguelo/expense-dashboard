# Expense Dashboard

A personal expense dashboard in a single, self-contained HTML file. No backend, no build step: everything you enter is saved in your browser's `localStorage`.

- `index.html`: the app, served as the live site.
- `expense-dashboard-v2.html`: a copy of the original file, kept for reference.

## Your data

Data stays in the browser where you entered it. It is not uploaded anywhere, and it doesn't sync between devices or browsers. Clearing your site data for the page deletes it.

## Run locally

Open `index.html` in a browser.

## Deployment

The site is hosted on GitHub Pages and served from the `main` branch root.

To redeploy after changes:

```bash
git add -A
git commit -m "Describe your change"
git push
```

GitHub Pages republishes automatically, usually within a minute or two. You can check progress under the repository's **Actions** tab, or by running `gh run list`.
