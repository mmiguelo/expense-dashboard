export const formatEur = (n: number): string => n.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });

/** Accepts both "12,50" and "12.50". Returns NaN for invalid input. */
export const parseAmount = (s: string | number): number => parseFloat(String(s).replace(',', '.'));

/** Amount as typed in the form: decimal comma. */
export const amountToInput = (n: number): string => String(n).replace('.', ',');

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export const escapeHtml = (s: unknown): string => String(s).replace(/[&<>"]/g, (c) => ESCAPES[c]!);
