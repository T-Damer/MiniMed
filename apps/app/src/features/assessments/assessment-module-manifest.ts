import type { AssessmentCatalogEntry } from '@/features/assessments/assessment-catalog';
import {
  ASSESSMENT_SECTIONS,
  type AssessmentSectionId,
  assessmentIdsInSection,
} from '@/features/assessments/assessment-packs';

const ASSESSMENT_TAG_PREFIX = 'assessment:';
const ASSESSMENT_SECTION_TAG_PREFIX = 'assessment-section:';
const NO_ASSESSMENT_DEPENDENCIES_TAG = 'assessment-dependencies:none';

function declarationError(tag: string, reason: string): Error {
  return new Error(`Invalid questionnaire dependency tag “${tag}”: ${reason}.`);
}

export function resolveDeclaredAssessmentDependencies(
  tags: readonly string[],
  definitions: readonly AssessmentCatalogEntry[],
): readonly string[] | null {
  const availableIds = new Set(definitions.map((definition) => definition.id));
  const sectionIds = new Set(ASSESSMENT_SECTIONS.map((section) => section.id));
  const assessmentIds = new Set<string>();
  let hasDeclaration = false;
  let declaresNone = false;

  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (tag === NO_ASSESSMENT_DEPENDENCIES_TAG) {
      hasDeclaration = true;
      declaresNone = true;
      continue;
    }

    if (tag.startsWith(ASSESSMENT_TAG_PREFIX)) {
      hasDeclaration = true;
      const assessmentId = tag.slice(ASSESSMENT_TAG_PREFIX.length);
      if (!assessmentId || !availableIds.has(assessmentId)) {
        throw declarationError(tag, 'unknown questionnaire ID');
      }
      assessmentIds.add(assessmentId);
      continue;
    }

    if (tag.startsWith(ASSESSMENT_SECTION_TAG_PREFIX)) {
      hasDeclaration = true;
      const sectionId = tag.slice(ASSESSMENT_SECTION_TAG_PREFIX.length) as AssessmentSectionId;
      if (!sectionIds.has(sectionId)) {
        throw declarationError(tag, 'unknown questionnaire section');
      }
      for (const assessmentId of assessmentIdsInSection(sectionId, definitions)) {
        assessmentIds.add(assessmentId);
      }
    }
  }

  if (!hasDeclaration) return null;
  if (declaresNone && assessmentIds.size > 0) {
    throw declarationError(
      NO_ASSESSMENT_DEPENDENCIES_TAG,
      'it cannot be combined with questionnaire or section declarations',
    );
  }
  return declaresNone ? [] : [...assessmentIds].toSorted();
}
