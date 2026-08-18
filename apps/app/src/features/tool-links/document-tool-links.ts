import { getAssessmentCatalog } from '@/features/assessments/assessment-catalog';
import { getCalculatorRegistry } from '@/features/calculators/calculator-registry';
import {
  createToolLinkMatcher,
  type ToolLinkSegment,
} from '@/features/tool-links/tool-link-matcher';

export type DocumentToolKind = 'assessment' | 'calculator';
export type DocumentToolTextSegment = ToolLinkSegment<DocumentToolKind>;

let cachedMatcher: ReturnType<typeof buildMatcher> | undefined;
let cachedCatalogSignature = '';

function catalogSignature(): string {
  const assessments = getAssessmentCatalog()
    .map((assessment) => assessment.id)
    .toSorted()
    .join(',');
  const calculators = getCalculatorRegistry()
    .filter((calculator) => calculator.state === 'available')
    .map((calculator) => calculator.id)
    .toSorted()
    .join(',');
  return `${assessments}|${calculators}`;
}

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

function getMatcher() {
  const signature = catalogSignature();
  if (cachedMatcher && cachedCatalogSignature === signature) return cachedMatcher;
  cachedMatcher = buildMatcher();
  cachedCatalogSignature = signature;
  return cachedMatcher;
}

export function ambiguousDocumentToolPhrases(): readonly string[] {
  return getMatcher().ambiguousPhrases;
}

export function segmentTextWithToolLinks(text: string): readonly DocumentToolTextSegment[] {
  return getMatcher().segment(text);
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
