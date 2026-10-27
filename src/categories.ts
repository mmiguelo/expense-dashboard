import type { Categories, KeywordRule, LearnedCategories, Transaction } from './types';

// The categories and keyword rules themselves are data: each account has its own, copied
// from the defaults an admin manages (tables default_categories and default_keyword_rules).

export const INCOME_CATEGORY = 'Income';
const INCOME_COLOR = '#3fa66b';
const FALLBACK_COLOR = '#9aa5b5';

/** Colours suggested, in rotation, for new categories. */
const CUSTOM_PALETTE = ['#0a8f8f', '#c05299', '#7d8f1f', '#a0522d', '#4b6cb7', '#cc7722'];

export const categoryColor = (cat: string, cats: Categories): string =>
  cat === INCOME_CATEGORY ? INCOME_COLOR : cats[cat] || FALLBACK_COLOR;

/** Suggested colour for the next category added to `cats`. */
export const nextCategoryColor = (cats: Categories): string =>
  CUSTOM_PALETTE[Object.keys(cats).length % CUSTOM_PALETTE.length]!;

/** Lower-case a keyword for storage. Spaces are kept: 'nos ' only matches the whole word. */
export const normalizeKeyword = (keyword: string): string => keyword.toLowerCase();

/**
 * Suggest a category for a description: first what the user picked for that exact
 * description before, then the first keyword rule that matches (for a category that
 * still exists).
 */
export function guessCategory(text: string, learned: LearnedCategories, rules: KeywordRule[], cats: Categories): string | null {
  const l = text.toLowerCase().trim();
  if (learned[l]) return learned[l];
  const s = ' ' + l + ' ';
  for (const r of rules) if (r.keyword && s.includes(r.keyword) && cats[r.category]) return r.category;
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
