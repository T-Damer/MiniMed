import { describe, expect, it } from 'vitest';

import { documentInteractiveToolLink } from '@/features/library/document-interactive-tool';

describe('documentInteractiveToolLink', () => {
  it('opens an explicitly linked assessment route', () => {
    expect(
      documentInteractiveToolLink({
        interactiveAssessmentId: 'assessment.phq9',
        interactiveRoute: '#/assessments/psychiatry/phq-9',
      }),
    ).toEqual({
      kind: 'assessment',
      id: 'assessment.phq9',
      href: '#/assessments/psychiatry/phq-9',
      label: 'Пройти',
    });
  });

  it('opens an explicitly linked calculator route', () => {
    expect(
      documentInteractiveToolLink({
        interactiveCalculatorId: 'calculator.curb65',
        interactiveRoute: '#/calculators/curb65',
      }),
    ).toEqual({
      kind: 'calculator',
      id: 'calculator.curb65',
      href: '#/calculators/curb65',
      label: 'Рассчитать',
    });
  });

  it('does not infer a route from an id, title or calculation flag', () => {
    expect(
      documentInteractiveToolLink({
        interactiveCalculatorId: 'calculator.curb65',
        calculationRequired: true,
        title: 'CURB-65',
      }),
    ).toBeUndefined();
  });

  it('rejects mismatched, ambiguous and non-local routes', () => {
    expect(
      documentInteractiveToolLink({
        interactiveAssessmentId: 'assessment.phq9',
        interactiveRoute: '#/calculators/phq9',
      }),
    ).toBeUndefined();
    expect(
      documentInteractiveToolLink({
        interactiveAssessmentId: 'assessment.phq9',
        interactiveCalculatorId: 'calculator.phq9',
        interactiveRoute: '#/assessments/psychiatry/phq9',
      }),
    ).toBeUndefined();
    expect(
      documentInteractiveToolLink({
        interactiveCalculatorId: 'calculator.curb65',
        interactiveRoute: 'https://example.invalid/calculators/curb65',
      }),
    ).toBeUndefined();
  });

  it('rejects malformed routes with whitespace, query strings or empty segments', () => {
    for (const route of [
      '#/calculators/curb 65',
      '#/calculators/curb65?patient=1',
      '#/calculators/curb65#result',
      '#/calculators//curb65',
    ]) {
      expect(
        documentInteractiveToolLink({
          interactiveCalculatorId: 'calculator.curb65',
          interactiveRoute: route,
        }),
      ).toBeUndefined();
    }
  });
});
