import { describe, expect, it } from 'vitest';

import { graphToneForSourceType } from '@/features/library/graph-tones';

describe('KnowledgeGraph source tones', () => {
  it('keeps clinical, drugs, legal sources and notes visually distinct', () => {
    expect(graphToneForSourceType('clinical_recommendation')).toBe('clinical');
    expect(graphToneForSourceType('official_drug_instruction')).toBe('drug');
    expect(graphToneForSourceType('regulatory_act')).toBe('legal');
    expect(graphToneForSourceType('personal_note')).toBe('notes');
  });
});
