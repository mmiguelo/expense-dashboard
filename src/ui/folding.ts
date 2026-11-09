import { t } from '../i18n';

/**
 * Sections with class "fold" collapse to their heading when its button is clicked.
 * `folded`: ids to start collapsed, or null to start with all of them collapsed.
 * `onChange` gets the collapsed ids after each click.
 */
export function setupFolding(doc: Document, folded: string[] | null, onChange: (folded: string[]) => void): void {
  const sections = [...doc.querySelectorAll<HTMLElement>('section.fold')];
  const set = (section: HTMLElement, collapsed: boolean) => {
    section.classList.toggle('folded', collapsed);
    const button = section.querySelector<HTMLButtonElement>('.foldbtn');
    if (!button) return;
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = t(collapsed ? 'common.expand' : 'common.collapse');
  };
  for (const section of sections) {
    set(section, folded === null || folded.includes(section.id));
    section.querySelector('.foldbtn')?.addEventListener('click', () => {
      set(section, !section.classList.contains('folded'));
      onChange(sections.filter((s) => s.classList.contains('folded')).map((s) => s.id));
    });
  }
}
