import { describe, expect, it } from 'vitest';
import { parseBackup, toCsv } from '../src/backup';
import { DEFAULT_CATEGORIES, guessCategory, missingCategories, nextCategoryColor } from '../src/categories';
import { inPeriod, shiftRef } from '../src/dates';
import { parseAmount } from '../src/format';

describe('shiftRef', () => {
  it('moves by days across month and year ends', () => {
    expect(shiftRef('2026-03-01', -1, 'day')).toBe('2026-02-28');
    expect(shiftRef('2026-12-31', 1, 'day')).toBe('2027-01-01');
  });

  it('moves to the 1st of the target month, so day 31 never skips a month', () => {
    expect(shiftRef('2026-01-31', 1, 'month')).toBe('2026-02-01');
    expect(shiftRef('2026-03-31', -1, 'month')).toBe('2026-02-01');
    expect(shiftRef('2026-01-15', -1, 'month')).toBe('2025-12-01');
  });

  it('moves by years, keeping the day', () => {
    expect(shiftRef('2026-05-20', -1, 'year')).toBe('2025-05-20');
  });
});

describe('inPeriod', () => {
  it('compares day, month or year', () => {
    expect(inPeriod('2026-03-05', '2026-03-31', 'month')).toBe(true);
    expect(inPeriod('2026-03-05', '2026-03-31', 'day')).toBe(false);
    expect(inPeriod('2026-12-31', '2026-01-01', 'year')).toBe(true);
  });
});

describe('parseAmount', () => {
  it('accepts a decimal comma or point', () => {
    expect(parseAmount('12,50')).toBe(12.5);
    expect(parseAmount('12.50')).toBe(12.5);
    expect(parseAmount('abc')).toBeNaN();
  });
});

describe('guessCategory', () => {
  it('prefers what the user picked before for the same description', () => {
    expect(guessCategory(' Lidl ', { lidl: 'Leisure' }, DEFAULT_CATEGORIES)).toBe('Leisure');
  });

  it('matches keywords', () => {
    expect(guessCategory('Pingo Doce Boavista', {}, DEFAULT_CATEGORIES)).toBe('Groceries');
    expect(guessCategory('Galp A1', {}, DEFAULT_CATEGORIES)).toBe('Fuel');
    expect(guessCategory('NOS', {}, DEFAULT_CATEGORIES)).toBe('Phone & Internet');
    expect(guessCategory('something else', {}, DEFAULT_CATEGORIES)).toBeNull();
  });

  it('ignores keyword categories that no longer exist', () => {
    expect(guessCategory('Lidl', {}, { Other: '#000' })).toBeNull();
  });
});

describe('missingCategories', () => {
  it('adds categories used by expenses, with rotating palette colours', () => {
    const tx = (cat: string, type: 'e' | 'i' = 'e') => ({ id: '1', date: '2026-01-01', amount: 1, desc: cat, cat, type });
    const cats = { A: '#000' };
    expect(missingCategories([tx('A'), tx('Pets'), tx('Pets'), tx('Kids'), tx('Income', 'i')], cats)).toEqual({
      Pets: '#c05299',
      Kids: '#7d8f1f',
    });
    // 13 defaults, so the first custom category gets the 2nd palette colour.
    expect(nextCategoryColor(DEFAULT_CATEGORIES)).toBe('#c05299');
  });
});

describe('backup', () => {
  it('exports CSV with quoted descriptions', () => {
    expect(
      toCsv([
        { id: '1', date: '2026-01-02', amount: 3.5, desc: 'Say "hi"', cat: 'Other', type: 'e', tags: 'a, b', fixed: 1 },
        { id: '2', date: '2026-01-03', amount: 100, desc: 'Salary', cat: 'Income', type: 'i' },
      ]),
    ).toBe('date,type,amount,category,description,tags,fixed\n2026-01-02,expense,3.5,Other,"Say ""hi""","a, b",1\n2026-01-03,income,100,Income,"Salary","",0');
  });

  it('accepts only JSON with a transactions array', () => {
    expect(parseBackup('{"ex":[],"bud":{"Gym":30}}')).toEqual({ ex: [], bud: { Gym: 30 } });
    expect(parseBackup('{"rec":[]}')).toBeNull();
    expect(parseBackup('null')).toBeNull();
    expect(parseBackup('not json')).toBeNull();
  });
});
