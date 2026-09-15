import type { TextRange } from '@localmed/contracts';
import type { AliasRecord } from '@localmed/domain';
import { describe, expect, it } from 'vitest';
import {
  type AliasExpansion,
  type AliasMatchSpan,
  type AliasMatchType,
  createAliasExpander,
  findNormalizedPhraseIndex,
  fuzzyPhraseSpan,
} from '../src/aliases';
import { normalizeSurfaceText, tokenize } from '../src/normalize';

// Independent pre-optimization scan: candidate filtering must not change lexical semantics.
function referenceExpansion(query: string, aliases: readonly AliasRecord[]): AliasExpansion {
  const normalizedQuery = normalizeSurfaceText(query);
  const terms = new Set<string>();
  const matches: string[] = [];
  const matchedAliases: AliasRecord[] = [];
  const matchSpans: AliasMatchSpan[] = [];

  for (const alias of aliases.toSorted((left, right) => right.alias.length - left.alias.length)) {
    const normalizedAlias = normalizeSurfaceText(alias.alias);
    const exactIndex = findNormalizedPhraseIndex(normalizedQuery, normalizedAlias);
    const matchType: AliasMatchType = exactIndex >= 0 ? 'exact' : 'fuzzy';
    let span: TextRange | null =
      exactIndex >= 0
        ? { start: exactIndex, end: exactIndex + normalizedAlias.length }
        : fuzzyPhraseSpan(normalizedQuery, normalizedAlias);
    if (!span) continue;
    // Prefer an explicit longer name (МКБ-10) over an embedded abbreviation (МКБ),
    // while retaining every meaning that matches the same complete span.
    while (span) {
      const current: TextRange = span;
      const covered = matchSpans.some(
        (match) =>
          match.matchType === 'exact' &&
          match.range.start <= current.start &&
          match.range.end >= current.end &&
          (match.range.start < current.start || match.range.end > current.end),
      );
      if (!covered) break;
      const offset: number = span.end;
      const next: number =
        matchType === 'exact'
          ? findNormalizedPhraseIndex(normalizedQuery.slice(offset), normalizedAlias)
          : -1;
      span =
        next < 0 ? null : { start: offset + next, end: offset + next + normalizedAlias.length };
    }
    if (!span) continue;

    matches.push(`${alias.alias} → ${alias.canonicalTerm}`);
    matchedAliases.push(alias);
    matchSpans.push({ alias, range: span, matchType });
    for (const term of tokenize(alias.canonicalTerm)) terms.add(term);
  }

  return { terms: [...terms], matches, matchedAliases, matchSpans };
}

describe('compiled alias vocabulary', () => {
  const aliases: AliasRecord[] = [
    { id: 'm1', alias: 'МКБ', canonicalTerm: 'Мочекаменная болезнь', weight: 1 },
    { id: 'm2', alias: 'МКБ', canonicalTerm: 'Международная классификация болезней', weight: 1 },
    { id: 'm3', alias: 'МКБ-10', canonicalTerm: 'Международная классификация болезней', weight: 1 },
    { id: 'drug', alias: 'цефтриаксон', canonicalTerm: 'Цефтриаксон', weight: 1 },
    {
      id: 'device',
      alias: 'Симбикорт Турбухалер',
      canonicalTerm: 'будесонид формотерол',
      weight: 1,
    },
    {
      id: 'long',
      alias: 'синдром Мюнхгаузена по доверенности',
      canonicalTerm: 'отдельное понятие',
      weight: 1,
    },
    { id: 'short', alias: 'синдром Мюнхгаузена', canonicalTerm: 'исходное понятие', weight: 1 },
    { id: 'neg', alias: 'боль в груди', canonicalTerm: 'загрудинная боль', weight: 1 },
    { id: 'short-abbr', alias: 'ОАК', canonicalTerm: 'общий анализ крови', weight: 1 },
    ...Array.from({ length: 200 }, (_, index) => ({
      id: `other-${index}`,
      alias: `синдром тестовый${index}`,
      canonicalTerm: `понятие ${index}`,
      weight: 1,
    })),
  ];
  const queryCases = [
    'МКБ',
    'МКБ-10 и МКБ',
    'Цефтриксон ребенку 3 лет',
    'турбухаллер',
    'синдром Мюнхгаузена',
    'синдром Мюнхгаузена по доверенности',
    'нет боли в груди',
    'ОАК',
    'предоак',
    'тестовый91 синдром',
    'синдром тестовыи100',
    'синдром несуществующий',
    'Симбикорт Турбухалер',
  ];
  it.each(queryCases)('retains scan results and exact spans for %s', (query) => {
    const expansion = createAliasExpander(aliases);
    expect(expansion(query)).toEqual(referenceExpansion(query, aliases));
    expect(expansion(query)).toEqual(referenceExpansion(query, aliases));
  });
  it('owns its snapshot instead of observing later mutable alias edits', () => {
    const original = [{ id: 'one', alias: 'Старое', canonicalTerm: 'Исходное', weight: 1 }];
    const compiled = createAliasExpander(original);
    const first = original[0];
    if (!first) throw new Error('Missing alias fixture.');
    first.alias = 'Новое';
    expect(compiled('Старое').matchedAliases[0]?.alias).toBe('Старое');
    expect(createAliasExpander(original)('Новое').matchedAliases[0]?.alias).toBe('Новое');
    expect(compiled('Новое').matchedAliases).toEqual([]);
  });
});
