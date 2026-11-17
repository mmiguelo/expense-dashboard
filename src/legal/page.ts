import '../fonts.css';
import '../styles.css';
import { getLang, initLang, setLang, t, type Lang } from '../i18n';
import { saveLanguage, savedLanguage } from '../storage/preferences';
import { setupLanguageSelect } from '../ui/language';
import { CONTACT_EMAIL, LEGAL, UPDATED, type Block, type DocName } from './content';

// terms.html and privacy.html: the document named by <body data-doc>, in the language
// chosen in the app (or picked here), with links back to the app and to each other.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const HREF: Record<DocName, string> = { terms: './terms.html', privacy: './privacy.html' };

/** Escaped text, with {email}, {terms} and {privacy} made links. */
export function inline(text: string, lang: Lang): string {
  return esc(text).replace(/\{(email|terms|privacy)\}/g, (_, name: string) =>
    name === 'email'
      ? `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`
      : `<a href="${HREF[name as DocName]}">${esc(LEGAL[lang][name as DocName].title)}</a>`,
  );
}

const block = (b: Block, lang: Lang): string =>
  'h' in b ? `<h2>${inline(b.h, lang)}</h2>` : 'p' in b ? `<p>${inline(b.p, lang)}</p>` : `<ul>${b.ul.map((li) => `<li>${inline(li, lang)}</li>`).join('')}</ul>`;

/** The page's content for `doc` in `lang`. */
export function legalHtml(doc: DocName, lang: Lang): string {
  const L = LEGAL[lang];
  const date = new Date(`${UPDATED}T12:00:00`).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' });
  const other: DocName = doc === 'terms' ? 'privacy' : 'terms';
  return `<h1>${esc(L[doc].title)}</h1>
<p class="mute">${esc(L.updated.replace('{date}', date))}</p>
${L[doc].blocks.map((b) => block(b, lang)).join('\n')}
<p class="legalnext"><a href="${HREF[other]}">${esc(L[other].title)}</a></p>`;
}

export function renderLegalPage(d: Document): void {
  const name = (d.body.dataset.doc === 'privacy' ? 'privacy' : 'terms') as DocName;
  const draw = () => {
    const lang = getLang();
    d.documentElement.lang = lang;
    d.title = `${LEGAL[lang][name].title} · ${t('page.title')}`;
    d.getElementById('legalBrand')!.textContent = t('page.title');
    d.getElementById('legalBack')!.textContent = LEGAL[lang].back;
    d.getElementById('legalBody')!.innerHTML = legalHtml(name, lang);
  };
  initLang(savedLanguage());
  setupLanguageSelect(d.getElementById('legalLang') as HTMLSelectElement, (lang) => {
    setLang(lang);
    saveLanguage(lang);
    draw();
  });
  draw();
}

if (typeof document !== 'undefined' && document.body?.dataset.doc) renderLegalPage(document);
