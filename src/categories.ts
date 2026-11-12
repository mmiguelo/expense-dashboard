import type { Categories, KeywordRule, LearnedCategories, Subcategories, Transaction, TxType } from './types';

// The categories and keyword rules themselves are data: each account has its own, copied
// from the defaults an admin manages (tables default_categories and default_keyword_rules).

/** The category of every income transaction. Old data used 'Income'. */
export const INCOME_CATEGORY = 'Rendimentos';
const LEGACY_INCOME_CATEGORY = 'Income';
const INCOME_COLOR = '#5e8c61';
/** The category of every savings transaction. */
export const SAVINGS_CATEGORY = 'Poupança';
const SAVINGS_COLOR = '#4f7a8c';
const FALLBACK_COLOR = '#a39b8b';

export const isIncomeCategory = (cat: string): boolean => cat === INCOME_CATEGORY || cat === LEGACY_INCOME_CATEGORY;

/** The fixed category of a transaction type, or null for expenses (which pick one). */
export const fixedCategoryOf = (type: TxType): string | null =>
  type === 'i' ? INCOME_CATEGORY : type === 's' ? SAVINGS_CATEGORY : null;

/** Category names an expense can use, in display order. */
export const expenseCategoryNames = (cats: Categories): string[] => Object.keys(cats).filter((c) => !isIncomeCategory(c));

/** Colours suggested, in rotation, for new categories. */
const CUSTOM_PALETTE = ['#8b6b56', '#7a2e3c', '#6f7442', '#b5643c', '#4f6d7a', '#c2a14d'];

export const categoryColor = (cat: string, cats: Categories): string =>
  cats[cat] || (isIncomeCategory(cat) ? INCOME_COLOR : cat === SAVINGS_CATEGORY ? SAVINGS_COLOR : FALLBACK_COLOR);

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
 * Suggest a subcategory from a description that names one, e.g. "Netflix março" ->
 * Subscrições / Netflix. Within `category` when given, otherwise in any category.
 * Names shorter than 3 letters are ignored, and the longest match wins.
 */
export function guessSubcategory(text: string, subs: Subcategories, category?: string): { cat: string; sub: string } | null {
  const s = ' ' + text.toLowerCase().trim() + ' ';
  let best: { cat: string; sub: string } | null = null;
  for (const [cat, names] of Object.entries(subs)) {
    if (category !== undefined ? cat !== category : isIncomeCategory(cat)) continue;
    for (const sub of names) {
      const n = sub.toLowerCase();
      if (n.length >= 3 && s.includes(n) && (!best || n.length > best.sub.length)) best = { cat, sub };
    }
  }
  return best;
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
