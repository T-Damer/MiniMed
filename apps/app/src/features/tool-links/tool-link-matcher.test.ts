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
});
