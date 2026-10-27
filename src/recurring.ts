import { daysInMonth, pad } from './dates';
import type { GeneratedMonths, RecurringExpense, Transaction } from './types';

export interface GeneratedRecurring {
  transactions: Transaction[];
  /** Keys to add to the generated-months record. */
  keys: string[];
}

export const generatedKey = (rule: RecurringExpense, month: string): string => rule.id + month;

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
  newId: () => number,
): GeneratedRecurring {
  const currentMonth = today.slice(0, 7);
  const done = new Set(Object.keys(generated));
  const out: GeneratedRecurring = { transactions: [], keys: [] };
  for (const r of rules) {
    let [y, m] = r.start.split('-').map(Number) as [number, number];
    for (;;) {
      const month = `${y}-${pad(m)}`;
      if (month > currentMonth) break;
      const date = `${month}-${pad(Math.min(r.day, daysInMonth(y, m)))}`;
      const key = generatedKey(r, month);
      if (date <= today && !done.has(key)) {
        done.add(key);
        out.keys.push(key);
        out.transactions.push({ id: newId(), date, amount: r.amount, desc: r.desc, cat: r.cat, type: 'e', fixed: 1, tags: 'recurring' });
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
