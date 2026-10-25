import { afterEach, describe, expect, it, vi } from 'vitest';
import { englishMessages, languages, LANGUAGE_KEY, loadLanguage, messages, saveLanguage, translate } from '../src/i18n';

afterEach(() => vi.unstubAllGlobals());

const values = { id: 'ABCD', day: 7, year: 2, count: 3, food: 15, error: 'Example error', a: 'Alpha', b: 'Beta', target: 'Target', village: 'New Eden', side: 'Alpha, Beta', reason: 'Reason', donor: 'Alpha', receiver: 'Beta', name: 'Rowan', trust: 65, sheep: 4, dogs: 2, grain: 8, flour: 2, bread: 4, wood: 6, tools: 3, settling: 2, settled: 3, isolated: 1, friend: 'Cora', stone: 8, axes: 2, homes: 1, armed: 3 };
const tokens = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

describe('interface languages', () => {
  it('translates new English messages and saved migration chronicles into every supported language', () => {
    for (const source of Object.keys(englishMessages)) for (const { id } of languages) {
      const template = translate(source, id), formatted = translate(source, id, values);
      // Kraken has the same spelling in English and Spanish.
      if (id !== 'en' && !(id === 'es' && source === 'Kraken')) expect(template).not.toBe(source);
      expect(tokens(template)).toEqual(tokens(source)); expect(formatted).not.toMatch(/\{\w+\}/);
      expect(translate(translate(source, 'en', values), id)).toBe(formatted);
    }
  });
  for (const language of languages.filter(language => language.id !== 'ru')) {
    it(`translates every message and preserves its parameters in ${language.id}`, () => {
      for (const source of Object.keys(messages)) {
        const template = translate(source, language.id);
        expect(template, source).not.toBe(source);
        expect(tokens(template), source).toEqual(tokens(source));
        const localized = translate(source, language.id, values);
        expect(localized, source).not.toMatch(/[А-Яа-яЁё]|\{\w+\}/);
        // Old saved chronicles contain formatted Russian text, not translation IDs.
        const savedText = translate(source, 'ru', values);
        expect(translate(savedText, language.id), source).toBe(localized);
      }
    });
  }
  it('translates nested save errors and truce reasons without changing settlement names', () => {
    expect(translate('Мир не сохранён. Хранилище недоступно. Игра продолжает работать.', 'en')).toBe('World not saved. Storage unavailable. You can keep playing.');
    expect(translate('Общее перемирие: Эртор — Новый Эдем. Слишком большие потери', 'en')).toBe('General truce: Эртор — Новый Эдем. Losses are too heavy');
    expect(translate('Эртор', 'ja')).toBe('Эртор');
    expect(translate('Custom mod message', 'es')).toBe('Custom mod message');
  });
  it('persists the selected language and ignores invalid preferences', () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
    expect(loadLanguage()).toBe('en');
    for (const { id } of languages) { expect(saveLanguage(id)).toBe(true); expect(loadLanguage()).toBe(id); }
    stored.set(LANGUAGE_KEY, 'unsupported'); expect(loadLanguage()).toBe('en');
  });
  it('keeps the interface usable when preference storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Unavailable'); }, setItem: () => { throw new Error('Unavailable'); } });
    expect(loadLanguage()).toBe('en'); expect(saveLanguage('ja')).toBe(false);
    expect(translate('Настройки', 'ja')).toBe('設定');
  });
  it('translates English source copy while preserving legacy message compatibility', () => {
    for (const [source, [english]] of Object.entries(messages)) {
      for (const { id } of languages) expect(translate(english, id, values)).toBe(translate(source, id, values));
    }
  });
});
