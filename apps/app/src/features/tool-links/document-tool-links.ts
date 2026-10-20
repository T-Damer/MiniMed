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
let catalogCheckedAt = Number.NEGATIVE_INFINITY;

/**
 * The registries hand out a fresh array on every call (a few hundred entries merged and sorted), and
 * a reader asks for the matcher once per paragraph: the signature is re-read at most this often, so a
 * tool installed while a document is open is linked from the next render a moment later.
 */
const CATALOG_RECHECK_MS = 750;

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
      // The doctor's own calculators are named freely: their titles are not phrases to link in sources.
      .filter((calculator) => calculator.state === 'available')
      .filter((calculator) => calculator.category !== 'custom')
      .map((calculator) => ({
        id: calculator.id,
        kind: 'calculator' as const,
        slug: calculator.slug,
        phrases: [calculator.title, calculator.shortTitle, ...calculator.aliases],
      })),
  ]);
}

function getMatcher() {
  const now = performance.now();
  if (cachedMatcher && now - catalogCheckedAt < CATALOG_RECHECK_MS) return cachedMatcher;
  catalogCheckedAt = now;
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
