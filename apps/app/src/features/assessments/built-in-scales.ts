import type { AssessmentCatalogEntry } from '@/features/assessments/assessment-catalog';
import type { DiaryQuestionnaireOption } from '@/features/diary/diary-questionnaires';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';

/** A built-in scale of a profile's questionnaire list: what it is called, and its catalog entry. */
export interface BuiltInScaleCard {
  readonly scale: DiaryQuestionnaireOption;
  readonly entry: AssessmentCatalogEntry;
}

/** What the scale measures, as a card's chip: «депрессия» → «Депрессия». */
export function scaleAboutLabel(scale: Pick<DiaryQuestionnaireOption, 'about'>): string {
  return scale.about.charAt(0).toLocaleUpperCase('ru-RU') + scale.about.slice(1);
}

/**
 * The cards of a questionnaire list for the scales a profile offers, in the profile's order: the
 * scales the (already age-filtered) catalog has an entry for, narrowed by the search text. A
 * scale the catalog does not know has no page to open, so it is not listed.
 */
export function builtInScaleCards(
  scales: readonly DiaryQuestionnaireOption[],
  catalog: readonly AssessmentCatalogEntry[],
  query: string,
): readonly BuiltInScaleCard[] {
  const bySlug = new Map(catalog.map((entry) => [entry.slug, entry]));
  return scales.flatMap((scale) => {
    const entry = bySlug.get(scale.slug);
    if (!entry) return [];
    const matches = matchesFuzzyQuery(query, [
      entry.title,
      entry.shortTitle,
      entry.description,
      scale.title,
      scale.about,
      ...entry.aliases,
    ]);
    return matches ? [{ scale, entry }] : [];
  });
}
