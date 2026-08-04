import {
  type DocumentToolTextSegment,
  segmentTextWithToolLinks,
} from '@/features/tool-links/document-tool-links';

export type AssessmentTextSegment = Exclude<DocumentToolTextSegment, { readonly kind: 'calculator' }>;

export function segmentTextWithAssessmentLinks(text: string): readonly AssessmentTextSegment[] {
  const segments: AssessmentTextSegment[] = [];
  for (const segment of segmentTextWithToolLinks(text)) {
    const value = segment.value;
    if (segment.kind === 'assessment') {
      segments.push(segment);
      continue;
    }
    const previous = segments.at(-1);
    if (previous?.kind === 'text') {
      segments[segments.length - 1] = { kind: 'text', value: previous.value + value };
    } else {
      segments.push({ kind: 'text', value });
    }
  }
  return segments;
}

export function openAssessment(slug: string): void {
  window.location.hash = `#/assessments/${encodeURIComponent(slug)}`;
}
