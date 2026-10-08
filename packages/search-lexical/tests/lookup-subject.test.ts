import type { AliasRecord } from '@localmed/domain';
import { describe, expect, it } from 'vitest';

import {
  audienceOfToken,
  buildLookupQueryPlan,
  findWordPrefixMatches,
  hasWordPrefix,
  isLookupSubjectToken,
  isShortCyrillicTerm,
  lookupGroupCovered,
  shortTermInflections,
} from '../src/index';

const alias = (canonicalTerm: string, aliasText: string): AliasRecord => ({
  id: aliasText,
  canonicalTerm,
  alias: aliasText,
  category: 'diagnosis',
  weight: 1,
});

describe('word-start matching', () => {
  it('finds a short word only as a word of its own, with inflections', () => {
    expect(hasWordPrefix('боли в животе', 'боли')).toBe(true);
    expect(hasWordPrefix('сильная болью', 'боль')).toBe(true);
    expect(hasWordPrefix('боли', 'боль')).toBe(true);
    expect(hasWordPrefix('болиголов пятнистый', 'боли')).toBe(false);
    expect(hasWordPrefix('небольшой', 'боль')).toBe(false);
  });

  it('keeps stems as prefixes and never matches inside a word', () => {
    expect(hasWordPrefix('травма головного мозга', 'голов')).toBe(true);
    expect(hasWordPrefix('головокружение при ходьбе', 'голов')).toBe(false);
    expect(hasWordPrefix('лептоменингеальный', 'менингеальн')).toBe(false);
    expect(hasWordPrefix('менингеальный синдром', 'менингеальн')).toBe(true);
    expect(hasWordPrefix('лептоменингит', 'менингит')).toBe(false);
    expect(findWordPrefixMatches('кашель и кашля', 'кашл')).toEqual([{ start: 9, end: 14 }]);
  });

  it('lists inflected forms of a short term, with the soft sign dropped', () => {
    expect(isShortCyrillicTerm('боль')).toBe(true);
    expect(isShortCyrillicTerm('кашель')).toBe(false);
    expect(isShortCyrillicTerm('g00')).toBe(false);
    expect(shortTermInflections('боль')).toEqual(expect.arrayContaining(['боль', 'боли', 'болью']));
  });
});

describe('lookup subject words', () => {
  it.each(['головы', 'менингит', 'нурофен'])('%s names a subject', (word) => {
    expect(isLookupSubjectToken(word)).toBe(true);
  });

  it.each(['таблетки', 'капли', 'ребенка', 'лекарство', 'инструкция', '500', 'мг'])(
    '%s does not',
    (word) => {
      expect(isLookupSubjectToken(word)).toBe(false);
    },
  );

  it('recognises audience words', () => {
    expect(audienceOfToken('ребенка')).toBe('children');
    expect(audienceOfToken('детей')).toBe('children');
    expect(audienceOfToken('взрослого')).toBe('adults');
    expect(audienceOfToken('менингит')).toBeUndefined();
  });
});

describe('lookup plan', () => {
  it('lists a short word exactly and keeps prefixes when told to', () => {
    const bound = buildLookupQueryPlan('от боли', []);
    expect(bound.ftsQuery).toContain('"боли" OR');
    expect(bound.ftsQuery).not.toContain('"боли"*');
    const plain = buildLookupQueryPlan('от боли', [], undefined, { boundShortTerms: false });
    expect(plain.ftsQuery).toContain('"боли"*');
  });

  it('covers a word through an alias only when most of the alias name is present', () => {
    const plan = buildLookupQueryPlan('насморк', [
      alias('Неаллергический эозинофильный ринит', 'насморк'),
    ]);
    const group = plan.lookupTermGroups?.[0];
    if (!group) throw new Error('expected a term group');
    expect(lookupGroupCovered(group, new Set(['насморк']))).toBe(true);
    expect(lookupGroupCovered(group, new Set(['эозинофильн']))).toBe(false);
    expect(lookupGroupCovered(group, new Set(['эозинофильн', 'неаллергическ']))).toBe(true);
  });

  it('keeps words that only an ambiguous synonym brings out of the title rescue (S4)', () => {
    const plan = buildLookupQueryPlan('пневмония у детей', [
      alias('вентилятор-ассоциированная пневмония', 'пневмония'),
      alias('внебольничная пневмония', 'пневмония'),
      alias('острый бронхит', 'пневмония'),
    ]);
    const rescue = plan.lookupTitleRescue;
    if (!rescue) throw new Error('expected a title rescue');
    expect(rescue.branch.ftsQuery).toContain('"пневмония"*');
    expect(rescue.branch.ftsQuery).not.toContain('ассоциирован');
  });

  it('reads a written form number as a phrase, never as an МКБ-10 number (S2)', () => {
    const plan = buildLookupQueryPlan('070/у', []);
    expect(plan.ftsQuery).toBe('"070 у"*');
    expect(buildLookupQueryPlan('025-1/у', []).ftsQuery).toBe('"025 1 у"*');
    expect(buildLookupQueryPlan('67.9', []).ftsQuery).toContain('"i67"*');
  });

  it('plans a title rescue only for a query that names an audience', () => {
    expect(buildLookupQueryPlan('менингит', []).lookupTitleRescue).toBeUndefined();
    const rescue = buildLookupQueryPlan('менингит у ребенка', []).lookupTitleRescue;
    if (!rescue) throw new Error('expected a title rescue');
    expect(rescue.branch.ftsQuery.startsWith('title : (')).toBe(true);
    expect(rescue.branch.ftsQuery).toContain('"менингит"*');
    expect(rescue.branch.ftsQuery).toContain('"детей"');
  });
});
