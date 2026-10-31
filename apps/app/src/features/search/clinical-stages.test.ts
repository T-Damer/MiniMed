import { describe, expect, it } from 'vitest';

import { CLINICAL_STAGE_LABEL, clinicalStage } from '@/features/search/clinical-stages';

describe('clinical search stages', () => {
  it('names what runs now, analysis before search before refresh', () => {
    expect(clinicalStage({ analysing: true, searching: true, refreshing: true })).toBe('analysis');
    expect(clinicalStage({ analysing: false, searching: true, refreshing: true })).toBe('search');
    expect(clinicalStage({ analysing: false, searching: false, refreshing: true })).toBe('refresh');
    expect(
      clinicalStage({ analysing: false, searching: false, refreshing: false }),
    ).toBeUndefined();
  });

  it('has a label for every stage', () => {
    for (const stage of ['analysis', 'search', 'refresh'] as const) {
      expect(CLINICAL_STAGE_LABEL[stage]).toMatch(/…$/u);
    }
  });
});
