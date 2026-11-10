import { t } from '../i18n';

// An eye button inside every password field, to show or hide what was typed.

const EYE =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/><path class="slash" d="M4 4l16 16"/></svg>';

export function setupPasswordToggles(root: ParentNode): void {
  root.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => {
    if (input.parentElement?.classList.contains('pwwrap')) return;
    const wrap = input.ownerDocument.createElement('span');
    wrap.className = 'pwwrap';
    input.replaceWith(wrap);
    wrap.append(input);

    const button = input.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'pwtoggle';
    button.innerHTML = EYE;
    const paint = () => {
      const shown = input.type === 'text';
      button.setAttribute('aria-pressed', String(shown));
      button.setAttribute('aria-label', t(shown ? 'password.hide' : 'password.show'));
      button.title = t(shown ? 'password.hide' : 'password.show');
    };
    button.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      paint();
      input.focus();
    });
    // Hidden again once the form is sent, so it isn't left on screen.
    input.form?.addEventListener('submit', () => {
      input.type = 'password';
      paint();
    });
    paint();
    wrap.append(button);
  });
}
