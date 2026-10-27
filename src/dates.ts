import type { Mode } from './types';

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const pad = (n: number): string => String(n).padStart(2, '0');

/** Local date as YYYY-MM-DD. */
export const toIsoDate = (d: Date): string => d.toLocaleDateString('sv');

/** Number of days in a month; `month` is 1-12. */
export const daysInMonth = (year: number, month: number): number => new Date(year, month, 0).getDate();

export const parseIsoDate = (iso: string): [number, number, number] =>
  iso.split('-').map(Number) as [number, number, number];

/** YYYY-MM-DD -> DD/MM/YYYY */
export const formatDmy = (iso: string): string => iso.split('-').reverse().join('/');

/** Whether `date` falls in the same day / month / year as `ref`. */
export function inPeriod(date: string, ref: string, mode: Mode): boolean {
  if (mode === 'day') return date === ref;
  if (mode === 'month') return date.slice(0, 7) === ref.slice(0, 7);
  return date.slice(0, 4) === ref.slice(0, 4);
}

/**
 * Move the reference date by `n` periods. In month mode the result is the 1st of the
 * target month, which avoids Jan 31 + 1 month rolling over into March.
 */
export function shiftRef(ref: string, n: number, mode: Mode): string {
  const [y, m, d] = parseIsoDate(ref);
  const dt = new Date(y, m - 1, d, 12);
  if (mode === 'day') dt.setDate(d + n);
  else if (mode === 'month') {
    dt.setDate(1);
    dt.setMonth(m - 1 + n);
  } else dt.setFullYear(y + n);
  return toIsoDate(dt);
}
