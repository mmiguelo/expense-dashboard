import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../src/i18n';
import { renderNotFoundPage } from '../src/notFoundPage';

// Loads the generated page in a browser-like environment, with its script running.
function open(url: string, lang?: string) {
  const dom = new JSDOM(renderNotFoundPage(), {
    url,
    runScripts: 'dangerously',
    beforeParse(window) {
      if (lang) window.localStorage.setItem('lang', lang);
    },
  });
  const doc = dom.window.document;
  return {
    lang: doc.documentElement.lang,
    title: doc.title,
    heading: doc.querySelector('h1')!.textContent,
    back: doc.getElementById('home')!.textContent,
    home: doc.getElementById('home')!.getAttribute('href'),
  };
}

describe('404 page', () => {
  it('is in Portuguese by default, also without the script', () => {
    expect(renderNotFoundPage()).toContain('<h1 data-t="notFound.title">Página não encontrada</h1>');
    expect(open('https://mmiguelo.github.io/expense-dashboard/x')).toMatchObject({ lang: 'pt', heading: 'Página não encontrada', back: 'Voltar ao painel' });
  });

  it('uses the language chosen in the app, for every language', () => {
    for (const [lang, dict] of Object.entries(LANGUAGES)) {
      expect(open('https://mmiguelo.github.io/expense-dashboard/x', lang)).toMatchObject({
        lang,
        heading: dict['notFound.title'],
        back: dict['notFound.back'],
        title: `${dict['notFound.title']} · ${dict['page.title']}`,
      });
    }
  });

  it('falls back to the default for an unknown saved language', () => {
    expect(open('https://mmiguelo.github.io/expense-dashboard/x', 'xx').lang).toBe('pt');
  });

  it('links back to the app at any depth', () => {
    expect(open('https://mmiguelo.github.io/expense-dashboard/a/b/c').home).toBe('/expense-dashboard/');
    expect(open('http://localhost:4173/missing').home).toBe('/');
  });
});
