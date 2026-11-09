import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { initLang, LANGUAGES, monthNames, setLang, t, tn, translateError, type MessageKey } from '../src/i18n';

afterEach(() => setLang('pt'));

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  it('is Portuguese by default, and every language uses the same placeholders', () => {
    expect(t('form.expense')).toBe('Despesa');
    for (const [lang, dict] of Object.entries(LANGUAGES))
      for (const key of Object.keys(LANGUAGES.pt) as MessageKey[])
        expect(placeholders(dict[key]), `${lang}: ${key}`).toEqual(placeholders(LANGUAGES.pt[key]));
  });

  it('fills placeholders and picks plurals', () => {
    expect(t('cat.exists', { name: 'Lazer' })).toBe('Já existe uma categoria chamada "Lazer".');
    expect(tn('import.done', 1)).toBe('Importado 1 movimento');
    expect(tn('import.done', 3)).toBe('Importados 3 movimentos');
    expect(tn('import.done', 0)).toBe('Importados 0 movimentos');
  });

  it('switches language, and ignores unknown saved languages', () => {
    expect(initLang('xx')).toBe('pt');
    expect(initLang('en')).toBe('en');
    expect(t('form.expense')).toBe('Expense');
    expect(monthNames()[0]).toBe('Jan');
    setLang('pt');
    expect(monthNames()).toHaveLength(12);
    expect(monthNames()[1]).toBe('fev');
  });

  it('translates the errors the database raises', () => {
    expect(translateError('Too many changes at once: at most 120 new entries per minute.')).toBe(t('db.tooMany'));
    expect(translateError('Limit reached: an account can have at most 200 rows in categories.')).toContain('200');
    expect(translateError('"Lazer" is still used by transactions or recurring expenses.')).toContain('"Lazer" ainda é usada');
    expect(translateError('something unexpected')).toBe('something unexpected');
  });

  it('has a translation for every key used in index.html', () => {
    const html = readFileSync('index.html', 'utf8');
    const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(50);
    for (const k of keys) expect(LANGUAGES.pt, k).toHaveProperty([k]);
  });
});
