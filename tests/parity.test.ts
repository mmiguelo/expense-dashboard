import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageRepository } from '../src/storage/localStorageRepository';
import { startApp } from '../src/ui/app';

// Runs the original single-file app (expense-dashboard-v2.html) and the new app side by
// side on the same data and interactions, and checks they render and store exactly the
// same thing. Delete this file once you change the UI on purpose.

const LEGACY_HTML = readFileSync('expense-dashboard-v2.html', 'utf8');
const NEW_HTML = readFileSync('index.html', 'utf8'); // jsdom doesn't run its module script
const START = new Date(2026, 2, 18, 10, 0).getTime(); // Wed 18 March 2026, local time
/** Frozen clock shared by both apps; only the TICK step moves it. */
let NOW = START;
const URL = 'https://app.test/';

const sequence = () => {
  let i = 0;
  return () => ++i / 1000;
};

function prepare(w: JSDOM['window'], storage: Record<string, unknown>) {
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, JSON.stringify(v));
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.confirm = () => true;
  w.alert = (m: string) => alerts.get(w)!.push(m);
  alerts.set(w, []);
  // Capture downloads instead of navigating.
  downloads.set(w, []);
  w.URL.createObjectURL = (b: Blob) => (downloads.get(w)!.push(b), 'blob:test');
  w.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloads.get(w)!.push(this.download);
  };
}

const downloads = new WeakMap<object, (Blob | string)[]>();
const alerts = new WeakMap<object, string[]>();

async function openLegacy(storage: Record<string, unknown>) {
  const dom = new JSDOM(LEGACY_HTML, {
    url: URL,
    runScripts: 'dangerously',
    beforeParse(w) {
      prepare(w, storage);
      const RealDate = w.Date;
      class FakeDate extends RealDate {
        constructor(...args: []) {
          if (args.length) super(...args);
          else super(NOW);
        }
        static now() {
          return NOW;
        }
      }
      w.Date = FakeDate as DateConstructor;
      w.Math.random = sequence();
    },
  });
  return dom;
}

async function openNew(storage: Record<string, unknown>) {
  const dom = new JSDOM(NEW_HTML, { url: URL });
  prepare(dom.window, storage);
  vi.spyOn(Math, 'random').mockImplementation(sequence());
  await startApp({ doc: dom.window.document, repo: new LocalStorageRepository(dom.window.localStorage), clock: () => new Date(NOW) });
  return dom;
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Everything a user can see, download or that gets persisted. */
async function observe(dom: JSDOM) {
  const doc = dom.window.document;
  const fields = [...doc.querySelectorAll<HTMLInputElement>('input:not([type=file]),select')].map(
    (e) => `${e.id || e.dataset.b}=${e.value}${e.disabled ? ' (disabled)' : ''}`,
  );
  const toast = doc.getElementById('toast')!;
  return {
    main: doc.querySelector('main')!.outerHTML,
    fields,
    toast: `${toast.style.display}: ${doc.getElementById('tm')!.textContent}`,
    stored: dom.window.localStorage.getItem('exp-v2'),
    downloads: await Promise.all(downloads.get(dom.window)!.map((d) => (typeof d === 'string' ? d : d.text()))),
    alerts: alerts.get(dom.window),
  };
}

type Action = (doc: Document, w: JSDOM['window']) => void;

/** Advance the shared clock by a second (once, for both apps). */
const TICK: Action = () => {};

async function compare(storage: Record<string, unknown>, steps: [string, Action][], { skipInitialStorage = false } = {}) {
  NOW = START;
  const legacy = await openLegacy(storage);
  const app = await openNew(storage);
  await settle();
  const initialNew = await observe(app);
  const initialLegacy = await observe(legacy);
  if (skipInitialStorage) initialNew.stored = initialLegacy.stored = null;
  expect(initialNew, 'initial render').toEqual(initialLegacy);
  for (const [name, act] of steps) {
    if (act === TICK) {
      NOW += 1000;
      continue;
    }
    act(legacy.window.document, legacy.window);
    act(app.window.document, app.window);
    await settle();
    expect(await observe(app), name).toEqual(await observe(legacy));
  }
}

// ---- interaction helpers ----
const set =
  (id: string, value: string, event: 'input' | 'change' = 'input'): Action =>
  (doc, w) => {
    const el = doc.getElementById(id) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new w.Event(event, { bubbles: true }));
  };
const click =
  (selector: string): Action =>
  (doc) =>
    (doc.querySelector(selector) as HTMLElement).click();
const enter =
  (id: string): Action =>
  (doc, w) =>
    doc.getElementById(id)!.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' }));
const pickFile =
  (content: string): Action =>
  (doc, w) => {
    const input = doc.getElementById('imp')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new w.File([content], 'backup.json')] });
    input.dispatchEvent(new w.Event('change'));
  };
const steps = (...actions: Action[]): Action => (doc, w) => actions.forEach((a) => a(doc, w));

// ---- data ----
const tx = (id: number, date: string, amount: number, desc: string, cat: string, extra = {}) => ({ id, date, amount, desc, cat, type: 'e', tags: '', ...extra });

const RICH = {
  'exp-v2': {
    ex: [
      tx(1, '2026-03-02', 54.3, 'Pingo Doce', 'Groceries', { tags: 'shared' }),
      tx(2, '2026-03-02', 12, 'Padaria', 'Groceries'),
      tx(3, '2026-03-05', 60, 'Galp', 'Fuel'),
      tx(4, '2026-03-17', 9.99, 'Netflix', 'Leisure'),
      tx(5, '2026-03-18', 25, 'Vet <Rex>', 'Pets', { tags: 'dog & cat' }),
      tx(6, '2026-02-10', 80, 'Pingo Doce', 'Groceries'),
      tx(7, '2026-02-28', 40, 'Galp', 'Fuel'),
      tx(8, '2025-07-01', 300, 'Ikea', 'Shopping'),
      { id: 9, date: '2026-03-01', amount: 1500, desc: 'Salary', cat: 'Income', type: 'i', tags: '' },
      tx(10, '2026-03-01', 650, 'Mortgage', 'Mortgage', { fixed: 1, tags: 'recurring' }),
    ],
    rec: [
      { id: 'r1', desc: 'Mortgage', amount: 650, cat: 'Mortgage', day: 1, start: '2026-03' },
      { id: 'r2', desc: 'Gym', amount: 35, cat: 'Gym', day: 31, start: '2025-11' },
    ],
    bud: { Groceries: 70, Fuel: 70, Health: 50 },
    cats: { Groceries: '#3fa66b', Fuel: '#7a8699', Leisure: '#d65db1', Mortgage: '#d1495b', Gym: '#e97a3b', Shopping: '#b5651d', Health: '#4cc3a0' },
    learn: { netflix: 'Leisure' },
    gen: { 'r12026-03': 1, 'r22025-11': 1 },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parity with the original single-file app', () => {
  it('renders an empty dashboard the same', async () => {
    await compare({}, [
      ['year mode', click('[data-m=year]')],
      ['day mode', click('[data-m=day]')],
    ]);
  });

  it('renders existing data the same in every mode and period', async () => {
    await compare(RICH, [
      ['previous month', click('#prev')],
      ['previous month again', click('#prev')],
      ['today', click('#today')],
      ['next month', click('#next')],
      ['year mode', click('[data-m=year]')],
      ['previous year', click('#prev')],
      ['today in year mode', click('#today')],
      ['day mode', click('[data-m=day]')],
      ['previous day', click('#prev')],
      ['back to month', click('[data-m=month]')],
      ['search', set('q', 'pingo')],
      ['search by tag', set('q', 'shared')],
      ['category filter', steps(set('q', ''), set('fc', 'Fuel', 'change'))],
      ['income filter', set('fc', 'Income', 'change')],
    ]);
  });

  it('reads the old expenses-v1 key the same', async () => {
    await compare(
      { 'expenses-v1': [{ id: 1, date: '2026-03-03', amount: 20, desc: 'Lidl', cat: 'Groceries' }, { id: 2, date: '2026-03-04', amount: 7, desc: 'Kebab', cat: 'Takeaway' }] },
      [['set a budget', (doc, w) => { const i = doc.querySelector<HTMLInputElement>('[data-b=Takeaway]')!; i.value = '30'; i.dispatchEvent(new w.Event('change')); }]],
      // The new app saves the colour for "Takeaway" straight away; the original only on the next change.
      { skipInitialStorage: true },
    );
  });

  it('handles adding, editing, deleting and undoing the same', async () => {
    await compare(RICH, [
      ['guess category from description', set('desc', 'Continente Maia')],
      ['type amount', set('amt', '23,40')],
      ['add with Enter', enter('amt')],
      ['add with learned category', steps(set('desc', 'Kiosk'), set('cat', 'Leisure', 'change'), set('amt', '3'), set('tags', 'snacks'), click('#sub'))],
      ['learned category is guessed', set('desc', 'kiosk')],
      ['reset', steps(set('desc', ''), click('#sub'))],
      ['add income', steps(set('type', 'i', 'change'), set('amt', '200'), set('desc', 'Freelance'), click('#sub'))],
      ['add on another date', steps(set('date', '2026-01-15'), set('amt', '5'), click('#sub'))],
      ['back to today', click('#today')],
      ['start editing', click('[data-edit="3"]')],
      ['save edit', steps(set('amt', '61,5'), set('desc', 'Galp Boavista'), click('#sub'))],
      ['edit income', click('[data-edit="9"]')],
      ['cancel edit', click('#cancel')],
      ['edit recurring occurrence', steps(click('[data-edit="10"]'), set('tags', 'house'), click('#sub'))],
      ['delete', click('[data-del="4"]')],
      ['undo', click('#undo')],
      ['delete again', click('[data-del="2"]')],
      ['quick pick', click('#chips button')],
      ['invalid amount is ignored', steps(set('amt', 'abc'), click('#sub'))],
    ]);
  });

  it('handles settings the same: budgets, recurring and categories', async () => {
    await compare(RICH, [
      ['set budget', (doc, w) => { const i = doc.querySelector<HTMLInputElement>('[data-b=Leisure]')!; i.value = '5,5'; i.dispatchEvent(new w.Event('change')); }],
      ['clear budget', (doc, w) => { const i = doc.querySelector<HTMLInputElement>('[data-b=Fuel]')!; i.value = ''; i.dispatchEvent(new w.Event('change')); }],
      ['add recurring on day 31', steps(set('rd', 'Insurance'), set('ra', '42'), set('rc', 'Health', 'change'), set('rday', '31'), click('#rb'))],
      ['a second later', TICK],
      ['add recurring due today', steps(set('rd', 'Phone'), set('ra', '20'), set('rday', '18'), click('#rb'))],
      ['add recurring without amount is ignored', steps(set('rd', 'Nope'), click('#rb'))],
      ['remove recurring', click('[data-rdel="r2"]')],
      ['add category', steps(set('nc', 'Kids'), click('#ncb'))],
      ['duplicate category is ignored', steps(set('nc', 'Kids'), click('#ncb'))],
      ['use new category', steps(set('desc', 'Toys'), set('cat', 'Kids', 'change'), set('amt', '15'), click('#sub'))],
      ['year view', click('[data-m=year]')],
    ]);
  });

  it('exports and imports backups the same', async () => {
    await compare(RICH, [
      ['export JSON', click('#xj')],
      ['export CSV', click('#xc')],
      ['import invalid file', pickFile('{"rec":[]}')],
      ['import non-JSON file', pickFile('hello')],
      ['import backup', pickFile(JSON.stringify({ ex: [tx(50, '2026-03-10', 99, 'Imported', 'Fuel')], bud: { Fuel: 10 } }))],
      ['export after import', click('#xj')],
    ]);
  });
});
