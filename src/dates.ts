import type { Mode } from './types';

export const pad = (n: number): string => String(n).padStart(2, '0');

/** Local date as YYYY-MM-DD. */
export const toIsoDate = (d: Date): string => d.toLocaleDateString('sv');

/** Number of days in a month; `month` is 1-12. */
export const daysInMonth = (year: number, month: number): number => new Date(year, month, 0).getDate();

export const parseIsoDate = (iso: string): [number, number, number] =>
  iso.split('-').map(Number) as [number, number, number];

/** YYYY-MM-DD -> DD/MM/YYYY */
export const formatDmy = (iso: string): string => iso.split('-').reverse().join('/');

/**
 * A date typed as day/month/year -> YYYY-MM-DD, or null if it is not a real date.
 * Accepts /, -, . or spaces between the parts, 1-digit days and months, 2-digit years
 * (taken as 20yy) and the 8 digits on their own (04112026).
 */
export function parseDmy(text: string): string | null {
  const s = text.trim();
  const m = s.match(/^(\d{1,2})[/.\-\s]+(\d{1,2})[/.\-\s]+(\d{2}|\d{4})$/) ?? s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

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
