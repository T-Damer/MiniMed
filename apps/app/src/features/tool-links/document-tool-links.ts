import { ASSESSMENT_CATALOG } from '@/features/assessments/assessment-catalog';
import { AVAILABLE_CALCULATORS } from '@/features/calculators/calculator-registry';
import {
  createToolLinkMatcher,
  type ToolLinkSegment,
} from '@/features/tool-links/tool-link-matcher';

export type DocumentToolKind = 'assessment' | 'calculator';
export type DocumentToolTextSegment = ToolLinkSegment<DocumentToolKind>;

const matcher = createToolLinkMatcher<DocumentToolKind>([
  ...ASSESSMENT_CATALOG.map((assessment) => ({
    id: assessment.id,
    kind: 'assessment' as const,
    slug: assessment.slug,
    phrases: [assessment.title, assessment.shortTitle, ...assessment.aliases],
  })),
  ...AVAILABLE_CALCULATORS.map((calculator) => ({
    id: calculator.id,
    kind: 'calculator' as const,
    slug: calculator.slug,
    phrases: [calculator.title, calculator.shortTitle, ...calculator.aliases],
  })),
]);

export const AMBIGUOUS_DOCUMENT_TOOL_PHRASES = matcher.ambiguousPhrases;

export function segmentTextWithToolLinks(text: string): readonly DocumentToolTextSegment[] {
  return matcher.segment(text);
}

export function assessmentIdsReferencedInText(text: string): readonly string[] {
  return [
    ...new Set(
      segmentTextWithToolLinks(text)
        .filter((segment) => segment.kind === 'assessment')
        .map((segment) => segment.id),
    ),
  ].toSorted();
}
