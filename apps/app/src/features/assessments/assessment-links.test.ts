import { describe, expect, it } from 'vitest';

import { segmentTextWithAssessmentLinks } from '@/features/assessments/assessment-links';

describe('assessment document links', () => {
  it('links common questionnaire names without changing surrounding text', () => {
    const text = 'Для саморефлексии можно использовать тест Белбина и PAEI.';
    const segments = segmentTextWithAssessmentLinks(text);
    expect(segments.map((segment) => segment.value).join('')).toBe(text);
    expect(segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'assessment', slug: 'team-role-profile' }),
        expect.objectContaining({ kind: 'assessment', slug: 'paei-work-style' }),
      ]),
    );
  });

  it('does not link a matching fragment inside a longer word', () => {
    expect(segmentTextWithAssessmentLinks('PAEIобразный текст')).toEqual([
      { kind: 'text', value: 'PAEIобразный текст' },
    ]);
  });
});
