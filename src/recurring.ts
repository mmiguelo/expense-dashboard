import { daysInMonth, pad } from './dates';
import type { GeneratedMonths, RecurringExpense, RecurringOccurrence } from './types';

export const generatedKey = (recurringId: string, month: string): string => recurringId + month;

/** Split a generated-months key back into recurring id and YYYY-MM. */
export const parseGeneratedKey = (key: string): { recurringId: string; month: string } => ({
  recurringId: key.slice(0, -7),
  month: key.slice(-7),
});

/**
 * Create the transactions recurring expenses owe up to and including `today` (YYYY-MM-DD),
 * one per rule per month from the rule's start month. Months already in `generated` are
 * skipped, so deleted occurrences don't come back. A day past the end of a month
 * (e.g. 31 in April) falls on that month's last day.
 */
export function generateRecurring(
  rules: RecurringExpense[],
  generated: GeneratedMonths,
  today: string,
  newId: () => string,
): RecurringOccurrence[] {
  const currentMonth = today.slice(0, 7);
  const done = new Set(Object.keys(generated));
  const out: RecurringOccurrence[] = [];
  for (const r of rules) {
    let [y, m] = r.start.split('-').map(Number) as [number, number];
    for (;;) {
      const month = `${y}-${pad(m)}`;
      if (month > currentMonth) break;
      const date = `${month}-${pad(Math.min(r.day, daysInMonth(y, m)))}`;
      const key = generatedKey(r.id, month);
      if (date <= today && !done.has(key)) {
        done.add(key);
        out.push({
          recurringId: r.id,
          month,
          transaction: { id: newId(), date, amount: r.amount, desc: r.desc, cat: r.cat, type: 'e', fixed: 1, tags: 'recurring' },
        });
      }
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  }
  return out;
}
