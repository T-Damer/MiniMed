import { describe, expect, it } from 'vitest';

import { buildSnippet } from '../src/snippet';

describe('snippet highlighting', () => {
  it('maps normalized matches back to original text offsets', () => {
    const result = buildSnippet('Кашель.   Часто дышит.', ['часто дышит'], Number.MAX_SAFE_INTEGER);

    expect(result.text).toBe('Кашель.   Часто дышит.');
    expect(result.ranges).toEqual([{ start: 10, end: 21 }]);
    expect(result.text.slice(result.ranges[0]?.start ?? 0, result.ranges[0]?.end ?? 0)).toBe(
      'Часто дышит',
    );
  });

  it('returns readable text when source fragments contain known HTML markup', () => {
    const result = buildSnippet(
      '<p>Кашель <strong>частый</strong>.</p><p>Температура &gt;38°C.</p>',
      ['частый'],
      Number.MAX_SAFE_INTEGER,
    );

    expect(result.text).toBe('Кашель частый.\nТемпература >38°C.\n');
    expect(result.text).not.toMatch(/<\/?(?:p|strong)>/u);
    expect(result.text.slice(result.ranges[0]?.start ?? 0, result.ranges[0]?.end ?? 0)).toBe(
      'частый',
    );
  });

  it('chooses a compact window containing the most distinct search terms', () => {
    const result = buildSnippet(
      `Каноническое расширение. ${'Регистрационные сведения. '.repeat(4)}САЛЬБУТАМОЛ. Лекарственная форма: аэрозоль.`,
      ['расширение', 'сальбутамол', 'аэрозоль'],
      100,
    );

    expect(result.text).toContain('САЛЬБУТАМОЛ');
    expect(result.text).toContain('аэрозоль');
  });

  it('strips details and summary tags from snippets', () => {
    const result = buildSnippet(
      '<details><summary>Форма</summary>САЛЬБУТАМОЛ АЭРОЗОЛЬ</details>',
      ['аэрозоль'],
      Number.MAX_SAFE_INTEGER,
    );

    expect(result.text).toContain('Форма');
    expect(result.text).toContain('САЛЬБУТАМОЛ АЭРОЗОЛЬ');
    expect(result.text).not.toMatch(/<\/?(?:details|summary)(?:\s|>)/iu);
  });

  it('prefers an exact known-field value over a longer prefix value', () => {
    const result = buildSnippet(
      `${'ТН: Препарат форте. Лекарственная форма: гель. '.repeat(8)}ТН: Препарат. Лекарственная форма: ТАБЛЕТКИ. Дозировка: 200.0 мг.`,
      ['препарат'],
      360,
    );

    expect(result.text).toContain('ТН: Препарат.');
    expect(result.text).toContain('200.0 мг');
    expect(result.text).not.toContain('Препарат форте');
  });
});
