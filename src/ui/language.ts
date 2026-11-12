import { getLang, LANGUAGE_NAMES, t, type Lang } from '../i18n';

// Choosing a language: "Idioma" in the account menu, and a picker on the landing page.
// Choosing one saves it and reloads the page in that language.

/** A <select> of the languages, e.g. on the landing page. */
export function setupLanguageSelect(select: HTMLSelectElement, choose: (lang: Lang) => void): void {
  select.innerHTML = (Object.keys(LANGUAGE_NAMES) as Lang[])
    .map((lang) => `<option value="${lang}" lang="${lang}"${lang === getLang() ? ' selected' : ''}>${LANGUAGE_NAMES[lang]}</option>`)
    .join('');
  select.addEventListener('change', () => {
    if (select.value !== getLang()) choose(select.value as Lang);
  });
}

export function setupLanguageMenu(doc: Document, choose: (lang: Lang) => void): void {
  const $ = (id: string) => doc.getElementById(id)!;
  const toggle = $('langToggle');
  const list = $('langList');
  $('langCurrent').textContent = LANGUAGE_NAMES[getLang()];

  list.innerHTML = (Object.keys(LANGUAGE_NAMES) as Lang[])
    .map((lang) => {
      const on = lang === getLang();
      return `<button type="button" class="menuitem langopt" role="menuitemradio" aria-checked="${on}" data-lang="${lang}" lang="${lang}">${LANGUAGE_NAMES[lang]}${on ? ' <span aria-hidden="true">✓</span>' : ''}</button>`;
    })
    .join('');

  toggle.addEventListener('click', () => {
    const open = list.hidden;
    list.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });
  list.addEventListener('click', (e) => {
    const lang = (e.target as HTMLElement).closest<HTMLElement>('[data-lang]')?.dataset.lang as Lang | undefined;
    if (lang && lang !== getLang()) choose(lang);
  });
  toggle.setAttribute('aria-label', `${t('account.language')}: ${LANGUAGE_NAMES[getLang()]}`);
}
