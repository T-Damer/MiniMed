import { describe, expect, it } from 'vitest';

import { graphDomainColor, graphToneForSourceType } from '@/features/library/graph-tones';

describe('KnowledgeGraph source tones', () => {
  it('keeps clinical, drugs, legal sources and notes visually distinct', () => {
    expect(graphToneForSourceType('clinical_recommendation')).toBe('clinical');
    expect(graphToneForSourceType('official_drug_instruction')).toBe('drug');
    expect(graphToneForSourceType('regulatory_act')).toBe('legal');
    expect(graphToneForSourceType('personal_note')).toBe('notes');
  });
});

describe('graph theme helpers', () => {
  it('uses darker domain fills in dark theme', () => {
    expect(graphDomainColor('pediatrics', false)).not.toBe(graphDomainColor('pediatrics', true));
  });
});
