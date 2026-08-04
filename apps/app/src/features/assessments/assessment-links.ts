import { segmentTextWithToolLinks } from '@/features/tool-links/document-tool-links';

export type AssessmentTextSegment =
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: 'assessment';
      readonly id: string;
      readonly slug: string;
      readonly value: string;
    };

export function segmentTextWithAssessmentLinks(text: string): readonly AssessmentTextSegment[] {
  const segments: AssessmentTextSegment[] = [];
  for (const segment of segmentTextWithToolLinks(text)) {
    if (segment.kind === 'assessment') {
      segments.push({
        kind: 'assessment',
        id: segment.id,
        slug: segment.slug,
        value: segment.value,
      });
      continue;
    }
    const previous = segments.at(-1);
    if (previous?.kind === 'text') {
      segments[segments.length - 1] = { kind: 'text', value: previous.value + segment.value };
    } else {
      segments.push({ kind: 'text', value: segment.value });
    }
  }
  return segments;
}

export function openAssessment(slug: string): void {
  window.location.hash = `#/assessments/${encodeURIComponent(slug)}`;
}
