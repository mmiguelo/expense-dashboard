import { getLang, LANGUAGE_NAMES, t, type Lang } from '../i18n';

// "Idioma" in the account menu: opens the list of languages; choosing one saves it and
// reloads the page in that language.

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
