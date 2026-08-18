import { describe, expect, it } from 'vitest';

import {
  countDocumentsByOverviewBucket,
  overviewBucketForSourceType,
} from '@/features/modules/overview-document-counts';

describe('overviewBucketForSourceType', () => {
  it('puts drug packs and registry cards on medications', () => {
    expect(overviewBucketForSourceType('allmed_reference')).toBe('medications');
    expect(overviewBucketForSourceType('official_drug_instruction')).toBe('medications');
    expect(overviewBucketForSourceType('official_registry_summary')).toBe('medications');
  });

  it('puts acts on regulatory and norms on reference', () => {
    expect(overviewBucketForSourceType('regulatory_act')).toBe('regulatory');
    expect(overviewBucketForSourceType('medical_reference')).toBe('reference');
  });

  it('counts only recommendation source types as clinical', () => {
    expect(overviewBucketForSourceType('clinical_recommendation')).toBe('clinical');
    expect(overviewBucketForSourceType('clinical_recommendation_summary')).toBe('clinical');
  });
});

describe('countDocumentsByOverviewBucket', () => {
  it('tallies live documents per overview card', () => {
    expect(
      countDocumentsByOverviewBucket([
        { sourceType: 'allmed_reference' },
        { sourceType: 'allmed_reference' },
        { sourceType: 'regulatory_act' },
        { sourceType: 'medical_reference' },
        { sourceType: 'clinical_recommendation_summary' },
        { sourceType: 'source_linked_summary' },
      ]),
    ).toEqual({
      medications: 2,
      reference: 1,
      regulatory: 1,
      clinical: 1,
      core: 1,
    });
  });
});
