import { describe, expect, it } from 'vitest';

import { ASSESSMENT_CATALOG } from '@/features/assessments/assessment-catalog';
import { builtInScaleCards, scaleAboutLabel } from '@/features/assessments/built-in-scales';
import { DIARY_QUESTIONNAIRES } from '@/features/diary/diary-questionnaires';
import { filterByAge } from '@/features/tools/tool-age-filter';
import { builtInScaleRoute } from '@/state/app-profile';

describe('built-in scales of a profile list', () => {
  it('has a catalog page at the address the profile allows for every diary questionnaire', () => {
    for (const scale of DIARY_QUESTIONNAIRES) {
      const entry = ASSESSMENT_CATALOG.find((candidate) => candidate.slug === scale.slug);
      expect(entry, scale.slug).toBeDefined();
      expect(entry?.bankId, scale.slug).toBe(scale.bank);
      expect(builtInScaleRoute(scale)).toBe(`#/assessments/${entry?.bankId}/${entry?.slug}`);
    }
  });

  it('lists every scale in the profile order', () => {
    const cards = builtInScaleCards(DIARY_QUESTIONNAIRES, ASSESSMENT_CATALOG, '');
    expect(cards.map((card) => card.scale.slug)).toEqual(
      DIARY_QUESTIONNAIRES.map((scale) => scale.slug),
    );
    expect(cards.every((card) => card.entry.slug === card.scale.slug)).toBe(true);
  });

  it('narrows by the search text over the name, description and what it measures', () => {
    const slugs = (query: string) =>
      builtInScaleCards(DIARY_QUESTIONNAIRES, ASSESSMENT_CATALOG, query).map(
        (card) => card.scale.slug,
      );
    expect(slugs('PHQ-9')).toContain('phq-9');
    expect(slugs('PHQ-9')).not.toContain('gad-7');
    expect(slugs('темперамент')).toContain('temperament-profile');
    expect(slugs('астения')).toContain('asthenic-state-shas');
    expect(slugs('zzzz нет такого')).toEqual([]);
  });

  it('skips a scale the catalog does not know and follows the age filter', () => {
    const withoutGad = ASSESSMENT_CATALOG.filter((entry) => entry.slug !== 'gad-7');
    expect(
      builtInScaleCards(DIARY_QUESTIONNAIRES, withoutGad, '').map((card) => card.scale.slug),
    ).not.toContain('gad-7');
    const children = filterByAge(ASSESSMENT_CATALOG, 'children');
    const all = builtInScaleCards(DIARY_QUESTIONNAIRES, ASSESSMENT_CATALOG, '');
    const forChildren = builtInScaleCards(DIARY_QUESTIONNAIRES, children, '');
    expect(forChildren.length).toBeLessThan(all.length);
    expect(forChildren.map((card) => card.scale.slug)).not.toContain('phq-9');
  });

  it('writes what a scale measures as a chip', () => {
    expect(scaleAboutLabel({ about: 'депрессия при беременности и после родов' })).toBe(
      'Депрессия при беременности и после родов',
    );
  });
});
