import { describe, expect, it } from 'vitest';
import { generateRecurring } from '../src/recurring';
import type { RecurringExpense } from '../src/types';

const rule = (over: Partial<RecurringExpense> = {}): RecurringExpense => ({
  id: 'r1',
  desc: 'Mortgage',
  amount: 650,
  cat: 'Mortgage',
  day: 1,
  start: '2026-01',
  ...over,
});

const ids = () => {
  let n = 0;
  return () => ++n;
};

const dates = (r: ReturnType<typeof generateRecurring>) => r.transactions.map((t) => t.date);

describe('generateRecurring', () => {
  it('creates one fixed expense per month from the start month up to today', () => {
    const r = generateRecurring([rule({ day: 5 })], {}, '2026-03-10', ids());
    expect(dates(r)).toEqual(['2026-01-05', '2026-02-05', '2026-03-05']);
    expect(r.keys).toEqual(['r12026-01', 'r12026-02', 'r12026-03']);
    expect(r.transactions[0]).toEqual({
      id: 1,
      date: '2026-01-05',
      amount: 650,
      desc: 'Mortgage',
      cat: 'Mortgage',
      type: 'e',
      fixed: 1,
      tags: 'recurring',
    });
  });

  it("doesn't create this month's expense before its day", () => {
    expect(dates(generateRecurring([rule({ day: 15 })], {}, '2026-03-14', ids()))).toEqual(['2026-01-15', '2026-02-15']);
  });

  it('creates it on the day itself', () => {
    expect(dates(generateRecurring([rule({ day: 15, start: '2026-03' })], {}, '2026-03-15', ids()))).toEqual(['2026-03-15']);
  });

  it('skips months already generated, so deleted occurrences stay deleted', () => {
    const r = generateRecurring([rule()], { 'r12026-01': 1, 'r12026-03': 1 }, '2026-03-31', ids());
    expect(dates(r)).toEqual(['2026-02-01']);
    expect(r.keys).toEqual(['r12026-02']);
  });

  it('generates nothing when the start month is in the future', () => {
    expect(generateRecurring([rule({ start: '2026-04' })], {}, '2026-03-31', ids())).toEqual({ transactions: [], keys: [] });
  });

  it('crosses year boundaries', () => {
    expect(dates(generateRecurring([rule({ start: '2025-11' })], {}, '2026-02-01', ids()))).toEqual([
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ]);
  });

  it('keeps rules separate and in order', () => {
    const r = generateRecurring([rule({ id: 'a', start: '2026-02' }), rule({ id: 'b', start: '2026-02', day: 2 })], {}, '2026-03-01', ids());
    expect(r.keys).toEqual(['a2026-02', 'a2026-03', 'b2026-02']);
  });

  describe('month-end clamping', () => {
    it('puts day 31 on the 30th in 30-day months', () => {
      const r = generateRecurring([rule({ day: 31, start: '2026-03' })], {}, '2026-07-31', ids());
      expect(dates(r)).toEqual(['2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31']);
    });

    it('puts days 29-31 on Feb 28 in a common year and Feb 29 in a leap year', () => {
      for (const day of [29, 30, 31]) {
        expect(dates(generateRecurring([rule({ day, start: '2026-02' })], {}, '2026-02-28', ids()))).toEqual(['2026-02-28']);
        expect(dates(generateRecurring([rule({ day, start: '2028-02' })], {}, '2028-02-29', ids()))).toEqual(['2028-02-29']);
      }
    });

    it('treats the clamped date as due on the last day of the month', () => {
      // Day 31 in April is due on April 30, not "never" and not May 1.
      expect(dates(generateRecurring([rule({ day: 31, start: '2026-04' })], {}, '2026-04-29', ids()))).toEqual([]);
      expect(dates(generateRecurring([rule({ day: 31, start: '2026-04' })], {}, '2026-04-30', ids()))).toEqual(['2026-04-30']);
    });

    it("doesn't clamp a day that fits", () => {
      expect(dates(generateRecurring([rule({ day: 28, start: '2026-02' })], {}, '2026-03-28', ids()))).toEqual(['2026-02-28', '2026-03-28']);
    });
  });

  it('does not mutate the generated record it is given', () => {
    const gen = {};
    generateRecurring([rule()], gen, '2026-02-01', ids());
    expect(gen).toEqual({});
  });
});
