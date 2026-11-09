import { DEFAULT_LANG, LANGUAGES } from './i18n';
import { SAVED_LANGUAGE_JS } from './storage/preferences';

// The 404 page GitHub Pages shows for any missing path under the site. Generated at build
// time (see vite.config.ts) so its texts come from src/i18n like the rest of the app.
//
// It must be self-contained: GitHub Pages serves it at whatever depth was requested
// (/expense-dashboard/a/b/c), so relative links to the app's assets wouldn't resolve.
// It shows the language this browser chose in the app (see storage/preferences.ts), or
// the default one.

const KEYS = ['page.title', 'notFound.title', 'notFound.text', 'notFound.back'] as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderNotFoundPage(): string {
  const texts = Object.fromEntries(
    Object.entries(LANGUAGES).map(([lang, dict]) => [lang, Object.fromEntries(KEYS.map((k) => [k, dict[k]]))]),
  );
  const d = LANGUAGES[DEFAULT_LANG];
  // In a <script>, "</" could end the element early; JSON allows escaping it.
  const json = JSON.stringify(texts).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="${DEFAULT_LANG}"><head><meta charset="utf-8">
<title>${esc(d['notFound.title'])} · ${esc(d['page.title'])}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,600&display=swap">
<style>
:root{--bg:#f2ebdf;--sf:#faf6ef;--ink:#3a2e29;--mute:#8a7c70;--line:#e3d8c7;--acc:#7a2e3c;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--ink);font:400 15px/1.5 "IBM Plex Sans",system-ui,sans-serif}
.card{max-width:440px;width:100%;background:var(--sf);border:1px solid var(--line);border-radius:3px;padding:28px 24px}
.code{font:500 13px/1 "IBM Plex Mono",ui-monospace,Menlo,monospace;letter-spacing:.12em;color:var(--acc);margin:0 0 14px}
h1{font:600 28px/1.15 "Newsreader",Georgia,"Times New Roman",serif;letter-spacing:-.01em;margin:0 0 10px}
p{margin:0 0 22px;color:var(--mute)}
a{display:inline-block;font-weight:500;font-size:14px;text-decoration:none;color:#fff;background:var(--acc);border:1px solid var(--acc);border-radius:2px;padding:8px 14px}
a:hover{background:#5f2230;border-color:#5f2230}
a:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
</style></head><body>
<main class="card">
<p class="code">404</p>
<h1 data-t="notFound.title">${esc(d['notFound.title'])}</h1>
<p data-t="notFound.text">${esc(d['notFound.text'])}</p>
<a id="home" href="/" data-t="notFound.back">${esc(d['notFound.back'])}</a>
</main>
<script>
(function () {
  var texts = ${json};
  var lang = ${SAVED_LANGUAGE_JS};
  if (!lang || !texts[lang]) lang = ${JSON.stringify(DEFAULT_LANG)};
  var t = texts[lang];
  document.documentElement.lang = lang;
  document.title = t['notFound.title'] + ' · ' + t['page.title'];
  document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = t[el.getAttribute('data-t')]; });
  // On <user>.github.io the app lives under /<repo>/; elsewhere at the root.
  var seg = location.pathname.split('/')[1];
  if (/\\.github\\.io$/.test(location.hostname) && seg) document.getElementById('home').href = '/' + seg + '/';
})();
</script>
</body></html>
`;
}
