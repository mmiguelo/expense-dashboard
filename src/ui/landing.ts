import { t } from '../i18n';

// The signed-out landing page: a large drawn donut chart rising from the bottom of the
// screen, turning in steps, with a ring of category names around it. The sign-in form
// opens in a panel over it.

type Mode = 'signin' | 'signup';

/** Ring colours: the default category palette, in the order of the slices. */
const SLICES: [weight: number, color: string][] = [
  [18, '#6f7442'],
  [14, '#8b6b56'],
  [12, '#3e5a73'],
  [10, '#5b8a9a'],
  [9, '#b5643c'],
  [9, '#4f6d7a'],
  [8, '#c2a14d'],
  [8, '#6c5a7c'],
  [7, '#d39b5a'],
  [5, '#c48b9f'],
];

const C = 500; // centre of the 1000×1000 drawing
const OUTER = 400;
const INNER = 235;
const LABELS = 462;

const point = (r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return `${(C + r * Math.cos(a)).toFixed(1)} ${(C + r * Math.sin(a)).toFixed(1)}`;
};

function slice(from: number, to: number): string {
  const large = to - from > 180 ? 1 : 0;
  return `M${point(OUTER, from)}A${OUTER} ${OUTER} 0 ${large} 1 ${point(OUTER, to)}L${point(INNER, to)}A${INNER} ${INNER} 0 ${large} 0 ${point(INNER, from)}Z`;
}

/**
 * The wheel. With `labels`, the full landing drawing with the ring of names; without, a
 * small version cropped to the wheel, with lines thick enough to read at icon size.
 */
export function donutSvg(labels?: string): string {
  const line = labels ? 9 : 34;
  const total = SLICES.reduce((s, [w]) => s + w, 0);
  let at = 0;
  let paths = '';
  let spokes = '';
  for (const [w, color] of SLICES) {
    const from = at;
    at += (w / total) * 360;
    paths += `<path d="${slice(from, at)}" fill="${color}"/>`;
    spokes += `<path d="M${point(INNER, from)}L${point(OUTER, from)}"/>`;
  }
  const ring = `<g class="lring">${paths}</g>
<g fill="none">
<circle cx="${C}" cy="${C}" r="${OUTER - 22}" stroke="#fff" stroke-opacity=".13" stroke-width="44"/>
<circle cx="${C}" cy="${C}" r="${INNER + 18}" stroke="#000" stroke-opacity=".08" stroke-width="36"/>
<circle cx="${C}" cy="${C}" r="${OUTER}" stroke="var(--ink)" stroke-width="${line}"/>
<circle cx="${C}" cy="${C}" r="${INNER}" stroke="var(--ink)" stroke-width="${line}" fill="var(--bg)"/>
</g>
<g class="lring" stroke="var(--ink)" stroke-width="${line}" stroke-linecap="round">${spokes}</g>`;
  if (!labels) {
    const pad = OUTER + line / 2;
    return `<svg viewBox="${C - pad} ${C - pad} ${2 * pad} ${2 * pad}" xmlns="http://www.w3.org/2000/svg">${ring}</svg>`;
  }
  // The names twice round, so the ring is full at any size.
  const text = (labels.split(',').join(' · ') + ' · ').repeat(2);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
<defs><path id="labelPath" d="M${C} ${C - LABELS}a${LABELS} ${LABELS} 0 1 1 0 ${2 * LABELS}a${LABELS} ${LABELS} 0 1 1 0 ${-2 * LABELS}"/></defs>
${ring}
<text class="llabels"><textPath href="#labelPath" textLength="${(2 * Math.PI * LABELS).toFixed(0)}" lengthAdjust="spacing">${esc(text)}</textPath></text>
</svg>`;
}

/**
 * Draw the landing page and wire its buttons, which open the sign-in panel in the mode
 * they name (`setMode` comes from setupAuthScreen). Returns `showSignedOut()` for the
 * note shown after logging out.
 */
export function setupLanding(doc: Document, setMode: (mode: Mode) => void): { showSignedOut(): void } {
  const $ = (id: string) => doc.getElementById(id)!;
  const page = $('auth');
  const panel = $('authPanel');
  $('landingArt').innerHTML = donutSvg(t('landing.ring'));

  let opener: HTMLElement | null = null;
  const close = () => {
    panel.hidden = true;
    page.classList.remove('panel-open');
    opener?.focus();
  };
  const open = (mode: Mode, from: HTMLElement) => {
    setMode(mode);
    opener = from;
    panel.hidden = false;
    page.classList.add('panel-open');
    (doc.getElementById('authEmail') as HTMLInputElement).focus();
  };

  page.querySelectorAll<HTMLElement>('[data-auth-open]').forEach((b) =>
    b.addEventListener('click', () => open(b.dataset.authOpen as Mode, b)),
  );
  $('authClose').addEventListener('click', close);
  // A click on the backdrop, outside the card, closes it.
  panel.addEventListener('click', (e) => {
    if (e.target === panel) close();
  });
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) close();
  });

  return { showSignedOut: () => ($('signedOutNote').hidden = false) };
}
