import { getAssessmentCatalog } from '@/features/assessments/assessment-catalog';
import { getCalculatorRegistry } from '@/features/calculators/calculator-registry';
import {
  createToolLinkMatcher,
  type ToolLinkSegment,
} from '@/features/tool-links/tool-link-matcher';

export type DocumentToolKind = 'assessment' | 'calculator';
export type DocumentToolTextSegment = ToolLinkSegment<DocumentToolKind>;

function buildMatcher() {
  return createToolLinkMatcher<DocumentToolKind>([
    ...getAssessmentCatalog().map((assessment) => ({
      id: assessment.id,
      kind: 'assessment' as const,
      slug: assessment.slug,
      phrases: [assessment.title, assessment.shortTitle, ...assessment.aliases],
    })),
    ...getCalculatorRegistry()
      .filter((calculator) => calculator.state === 'available')
      .map((calculator) => ({
        id: calculator.id,
        kind: 'calculator' as const,
        slug: calculator.slug,
        phrases: [calculator.title, calculator.shortTitle, ...calculator.aliases],
      })),
  ]);
}

export function ambiguousDocumentToolPhrases(): readonly string[] {
  return buildMatcher().ambiguousPhrases;
}

export const AMBIGUOUS_DOCUMENT_TOOL_PHRASES = ambiguousDocumentToolPhrases();

export function segmentTextWithToolLinks(text: string): readonly DocumentToolTextSegment[] {
  return buildMatcher().segment(text);
}

export function assessmentIdsReferencedInText(text: string): readonly string[] {
  return [
    ...new Set(
      segmentTextWithToolLinks(text).flatMap((segment) =>
        segment.kind === 'assessment' ? [segment.id] : [],
      ),
    ),
  ].toSorted();
}
