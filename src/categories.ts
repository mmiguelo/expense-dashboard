import type { Categories, LearnedCategories, Transaction } from './types';

export const INCOME_CATEGORY = 'Income';
const INCOME_COLOR = '#3fa66b';
const FALLBACK_COLOR = '#9aa5b5';

export const DEFAULT_CATEGORIES: Categories = {
  Groceries: '#3fa66b',
  Utilities: '#e0a526',
  Insurance: '#8a63d2',
  Mortgage: '#d1495b',
  Gym: '#e97a3b',
  Transportation: '#2aa6b8',
  Fuel: '#7a8699',
  Education: '#2f5bea',
  Leisure: '#d65db1',
  Health: '#4cc3a0',
  'Phone & Internet': '#5b8def',
  Shopping: '#b5651d',
  Other: '#9aa5b5',
};

/** Substrings matched against the lower-cased description, padded with spaces. */
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Groceries: ['pingo doce', 'continente', 'lidl', 'aldi', 'minipreço', 'intermarché', 'mercado', 'supermarket', 'padaria', 'talho'],
  Utilities: ['edp', 'endesa', 'energy', 'electric', 'luz', 'gas', 'água', 'agua', 'water', 'epal'],
  Insurance: ['insurance', 'seguro', 'fidelidade', 'ageas'],
  Mortgage: ['mortgage', 'crédito habitação', 'loan', 'prestação'],
  Gym: ['gym', 'ginásio', 'holmes', 'fitness'],
  Transportation: ['bus', 'autocarro', 'metro', 'train', 'uber', 'bolt', 'taxi', 'passe'],
  Fuel: ['fuel', 'petrol', 'diesel', 'gasolina', 'gasóleo', 'galp', 'repsol', 'shell'],
  Education: ['school', 'course', 'udemy', 'book', 'livro', 'tuition', 'escola'],
  Leisure: ['restaurant', 'restaurante', 'cinema', 'café', 'cafe', 'netflix', 'spotify', 'movie', 'pizza', 'sushi'],
  Health: ['pharmacy', 'farmácia', 'doctor', 'médico', 'dentist', 'dentista', 'clinic'],
  'Phone & Internet': ['nos ', 'meo', 'vodafone', 'nowo', 'internet', 'phone'],
  Shopping: ['amazon', 'zara', 'ikea', 'fnac', 'worten', 'roupa'],
};

/** Colours handed out, in rotation, to custom categories. */
const CUSTOM_PALETTE = ['#0a8f8f', '#c05299', '#7d8f1f', '#a0522d', '#4b6cb7', '#cc7722'];

export const categoryColor = (cat: string, cats: Categories): string =>
  cat === INCOME_CATEGORY ? INCOME_COLOR : cats[cat] || FALLBACK_COLOR;

/** Colour for the next category added to `cats`. */
export const nextCategoryColor = (cats: Categories): string =>
  CUSTOM_PALETTE[Object.keys(cats).length % CUSTOM_PALETTE.length]!;

/**
 * Suggest a category for a description: first what the user picked for that exact
 * description before, then keyword matching (only for categories that still exist).
 */
export function guessCategory(text: string, learned: LearnedCategories, cats: Categories): string | null {
  const l = text.toLowerCase().trim();
  if (learned[l]) return learned[l];
  const s = ' ' + l + ' ';
  for (const c in CATEGORY_KEYWORDS) if (CATEGORY_KEYWORDS[c]!.some((w) => s.includes(w)) && cats[c]) return c;
  return null;
}

/**
 * Categories used by expenses but missing from `cats` (e.g. from old data), with the
 * colours they get when added in order.
 */
export function missingCategories(transactions: Transaction[], cats: Categories): Categories {
  const all = { ...cats };
  const added: Categories = {};
  for (const x of transactions) {
    if (x.type === 'e' && !all[x.cat]) all[x.cat] = added[x.cat] = nextCategoryColor(all);
  }
  return added;
}
