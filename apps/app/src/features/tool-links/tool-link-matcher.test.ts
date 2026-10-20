import { describe, expect, it } from 'vitest';

import { createToolLinkMatcher } from '@/features/tool-links/tool-link-matcher';

describe('tool link matcher', () => {
  it('matches longest phrases in one pass and preserves source text', () => {
    const matcher = createToolLinkMatcher([
      { id: 'short', kind: 'calculator' as const, slug: 'short', phrases: ['СКФ'] },
      {
        id: 'long',
        kind: 'calculator' as const,
        slug: 'long',
        phrases: ['СКФ CKD-EPI 2021'],
      },
      { id: 'test', kind: 'assessment' as const, slug: 'test', phrases: ['Тест Бравермана'] },
    ]);
    const text = 'Пройдите Тест Бравермана и рассчитайте СКФ CKD-EPI 2021.';
    const segments = matcher.segment(text);

    expect(segments.map((segment) => segment.value).join('')).toBe(text);
    expect(segments.filter((segment) => segment.kind !== 'text')).toEqual([
      expect.objectContaining({ kind: 'assessment', id: 'test', slug: 'test' }),
      expect.objectContaining({ kind: 'calculator', id: 'long', slug: 'long' }),
    ]);
  });

  it('supports flexible whitespace and treats е and ё as equivalent', () => {
    const matcher = createToolLinkMatcher([
      {
        id: 'score',
        kind: 'assessment' as const,
        slug: 'score',
        phrases: ['Шкала тревожённости'],
      },
    ]);

    expect(matcher.segment('Шкала   тревоженности')).toEqual([
      {
        kind: 'assessment',
        id: 'score',
        slug: 'score',
        value: 'Шкала   тревоженности',
      },
    ]);
  });

  it('does not link inside longer words', () => {
    const matcher = createToolLinkMatcher([
      { id: 'bsa', kind: 'calculator' as const, slug: 'bsa', phrases: ['ППТ'] },
    ]);

    expect(matcher.segment('ППТобразный фрагмент')).toEqual([
      { kind: 'text', value: 'ППТобразный фрагмент' },
    ]);
  });

  it('drops ambiguous phrases instead of choosing by catalog order', () => {
    const matcher = createToolLinkMatcher([
      { id: 'first', kind: 'assessment' as const, slug: 'first', phrases: ['Общая шкала'] },
      { id: 'second', kind: 'calculator' as const, slug: 'second', phrases: ['общая шкала'] },
    ]);

    expect(matcher.ambiguousPhrases).toEqual(['общая шкала']);
    expect(matcher.segment('Общая шкала')).toEqual([{ kind: 'text', value: 'Общая шкала' }]);
  });

  it('leaves an abbreviation that follows a number as a unit, not a link', () => {
    const matcher = createToolLinkMatcher([
      { id: 'zung', kind: 'assessment' as const, slug: 'zung', phrases: ['SDS'] },
    ]);

    for (const text of ['выше +1 SDS', 'ниже −2 SDS', 'от 1,5 SDS до 2 SDS']) {
      expect(matcher.segment(text), text).toEqual([{ kind: 'text', value: text }]);
    }
    expect(
      matcher.segment('Шкала SDS заполняется сам').filter((s) => s.kind !== 'text'),
    ).toHaveLength(1);
    expect(matcher.segment('SDS 52 балла').filter((s) => s.kind !== 'text')).toHaveLength(1);
  });

  it('finds a phrase by its first word whatever the case, ё or punctuation around it', () => {
    const matcher = createToolLinkMatcher([
      { id: 'score', kind: 'assessment' as const, slug: 'score', phrases: ['Шкала Лёвина'] },
      { id: 'ckd', kind: 'calculator' as const, slug: 'ckd', phrases: ['CKD-EPI'] },
    ]);

    for (const [text, linked] of [
      ['ШКАЛА левина', 'ШКАЛА левина'],
      ['(шкала   Левина).', 'шкала   Левина'],
      ['по формуле ckd-epi 2021', 'ckd-epi'],
    ] as const) {
      expect(
        matcher.segment(text).find((segment) => segment.kind !== 'text'),
        text,
      ).toEqual(expect.objectContaining({ value: linked }));
    }
  });

  it('answers a text without any phrase word as plain text', () => {
    const matcher = createToolLinkMatcher([
      { id: 'score', kind: 'assessment' as const, slug: 'score', phrases: ['Шкала Лёвина'] },
    ]);
    const text = 'Левина без шкалы и шкалаЛевина слитно, 12 пунктов.';

    expect(matcher.segment(text)).toEqual([{ kind: 'text', value: text }]);
  });

  it('agrees with a single alternation over generated texts', () => {
    const definitions = [
      { id: 'a', kind: 'calculator' as const, slug: 'a', phrases: ['СКФ', 'СКФ CKD-EPI 2021'] },
      { id: 'b', kind: 'assessment' as const, slug: 'b', phrases: ['Шкала Лёвина', 'шкала'] },
      { id: 'c', kind: 'calculator' as const, slug: 'c', phrases: ['Индекс массы тела', 'ИМТ'] },
      { id: 'd', kind: 'assessment' as const, slug: 'd', phrases: ['SDS', 'Шкала Цунга (SDS)'] },
      { id: 'e', kind: 'calculator' as const, slug: 'e', phrases: ['6-минутный тест'] },
    ];
    const matcher = createToolLinkMatcher(definitions);
    const reference = referenceSegments(definitions);
    const pieces = [
      'СКФ',
      'ckd-epi',
      '2021',
      'шкала',
      'Шкалы',
      'левина',
      'Лёвина',
      'индекс',
      'массы',
      'тела',
      'ИМТ',
      'имт',
      'SDS',
      '+1 SDS',
      'Цунга',
      '(SDS)',
      '6-минутный',
      'тест',
      'и',
      'при',
      '12',
      ',',
      '.',
      '(',
      ')',
      '—',
      'ППТ',
      'ЛЁВИНА',
      'тест—',
      '😀',
      'Ёлка',
      'mass_index',
      'İМТ',
      'ИМТ.',
    ];
    const separators = [' ', '  ', '\u00a0', '\n', ' \t ', ''];
    let seed = 7;
    const next = (limit: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % limit;
    };
    for (let round = 0; round < 1500; round += 1) {
      const words = Array.from({ length: 1 + next(9) }, () => pieces[next(pieces.length)] ?? '');
      const text = words.reduce(
        (joined, word) => `${joined}${separators[next(separators.length)] ?? ' '}${word}`,
        '',
      );
      expect(matcher.segment(text), text).toEqual(reference(text));
    }
  });
});

/** The matcher as it was before the phrases were grouped by their first word: one expression. */
function referenceSegments(
  definitions: readonly {
    id: string;
    kind: 'assessment' | 'calculator';
    slug: string;
    phrases: readonly string[];
  }[],
): (text: string) => readonly unknown[] {
  const normalize = (value: string): string =>
    value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
  const byPhrase = new Map<string, (typeof definitions)[number]>();
  for (const definition of definitions) {
    for (const phrase of definition.phrases) byPhrase.set(normalize(phrase), definition);
  }
  const phrases = [...byPhrase.keys()].sort(
    (left, right) => right.length - left.length || left.localeCompare(right, 'ru-RU'),
  );
  const pattern = (value: string): string =>
    value
      .split(/\s+/u)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/[её]/giu, '[её]'))
      .join('\\s+');
  const expression = new RegExp(
    `(^|[^\\p{L}\\p{M}\\p{N}_])(${phrases.map(pattern).join('|')})(?=$|[^\\p{L}\\p{M}\\p{N}_])`,
    'giu',
  );
  const numberBefore = /(?:^|[^\p{L}\p{N}])[+\-−–]?\d+(?:[.,]\d+)?\s*$/u;
  return (text) => {
    expression.lastIndex = 0;
    const out: unknown[] = [];
    let cursor = 0;
    for (let match = expression.exec(text); match; match = expression.exec(text)) {
      const linked = match[2] ?? '';
      const definition = byPhrase.get(normalize(linked));
      const start = match.index + (match[1] ?? '').length;
      if (!definition || start < cursor) continue;
      const abbreviation = /^[\p{Lu}\p{N}-]{2,8}$/u.test(linked) && /\p{Lu}/u.test(linked);
      if (abbreviation && numberBefore.test(text.slice(Math.max(0, start - 12), start))) continue;
      if (start > cursor) out.push({ kind: 'text', value: text.slice(cursor, start) });
      out.push({ kind: definition.kind, id: definition.id, slug: definition.slug, value: linked });
      cursor = start + linked.length;
    }
    if (cursor < text.length) out.push({ kind: 'text', value: text.slice(cursor) });
    return out.length > 0 ? out : [{ kind: 'text', value: text }];
  };
}
