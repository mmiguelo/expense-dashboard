// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../src/i18n';
import { CONTACT_EMAIL, CONTROLLER, LEGAL } from '../src/legal/content';
import { inline, legalHtml } from '../src/legal/page';
import { markSignedOut, takeSignedOut } from '../src/storage/preferences';
import { fillWithLinks } from '../src/ui/auth';

describe('terms and privacy', () => {
  it('exist in every language, with the same sections, naming who runs the service', () => {
    for (const lang of Object.keys(LANGUAGES) as (keyof typeof LANGUAGES)[]) {
      for (const doc of ['terms', 'privacy'] as const) {
        const shape = (l: typeof lang) => LEGAL[l][doc].blocks.map((b) => Object.keys(b)[0] + ('ul' in b ? b.ul.length : ''));
        expect(shape(lang), `${lang} ${doc}`).toEqual(shape('pt'));
        const html = legalHtml(doc, lang);
        expect(html).toContain(`mailto:${CONTACT_EMAIL}`);
      }
      expect(legalHtml('privacy', lang)).toContain(CONTROLLER);
    }
  });

  it('escapes the text and links {email}, {terms} and {privacy}', () => {
    expect(inline('<b> {email}', 'pt')).toBe(`&lt;b&gt; <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`);
    expect(inline('see {privacy}', 'en')).toBe('see <a href="./privacy.html">Privacy Policy</a>');
    expect(legalHtml('terms', 'es')).toContain('<h1>Términos de Uso</h1>');
    expect(legalHtml('terms', 'pt')).toContain('17 de novembro de 2026');
  });

  it('the sign-up notice turns placeholders into links', () => {
    const p = document.createElement('p');
    fillWithLinks(p, 'Accept the {terms} & {privacy}.', { terms: ['./terms.html', 'Terms'], privacy: ['./privacy.html', 'Privacy'] });
    expect(p.innerHTML).toBe('Accept the <a href="./terms.html" target="_blank" rel="noopener">Terms</a> &amp; <a href="./privacy.html" target="_blank" rel="noopener">Privacy</a>.');
  });
});

describe('leaving note', () => {
  it('remembers whether the user signed out or deleted their account, once', () => {
    expect(takeSignedOut()).toBeNull();
    markSignedOut();
    expect(takeSignedOut()).toBe('signedOut');
    markSignedOut('deleted');
    expect(takeSignedOut()).toBe('deleted');
    expect(takeSignedOut()).toBeNull();
  });
});
