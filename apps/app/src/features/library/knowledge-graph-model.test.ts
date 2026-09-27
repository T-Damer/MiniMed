import type { MedicalDocumentSummary } from '@localmed/contracts';
import { describe, expect, it } from 'vitest';

import { selectGraphNeighborhood } from '@/features/library/knowledge-graph-model';

const document = (id: string, specialties: string[]): MedicalDocumentSummary => ({
  id,
  title: id,
  shortTitle: null,
  sourceType: 'clinical_recommendation',
  status: 'active',
  specialties,
  versionId: `${id}.v1`,
  versionLabel: '1',
  effectiveFrom: null,
});

describe('graph neighbourhood', () => {
  const documents = [
    ...Array.from({ length: 400 }, (_, index) => document(`cardio-${index}`, ['cardiology'])),
    ...Array.from({ length: 400 }, (_, index) => document(`neuro-${index}`, ['neurology'])),
    document('both', ['cardiology', 'pediatrics']),
  ];

  it('shows a small scope whole', () => {
    const selection = selectGraphNeighborhood(documents.slice(0, 10));
    expect(selection).toMatchObject({ total: 10, focused: false });
    expect(selection.documents).toHaveLength(10);
  });

  it('samples a large scope evenly across areas and reports the total', () => {
    const selection = selectGraphNeighborhood(documents, { limit: 100 });
    expect(selection.total).toBe(801);
    expect(selection.documents).toHaveLength(100);
    const cardio = selection.documents.filter((entry) => entry.id.startsWith('cardio'));
    expect(cardio.length).toBeGreaterThan(40);
    expect(cardio.length).toBeLessThan(60);
  });

  it('centres on search results and adds first-level neighbours from their areas', () => {
    const selection = selectGraphNeighborhood(documents, {
      focusIds: new Set(['both', 'neuro-7']),
      limit: 30,
    });
    expect(selection.focused).toBe(true);
    expect(
      selection.documents
        .slice(0, 2)
        .map((entry) => entry.id)
        .toSorted(),
    ).toEqual(['both', 'neuro-7']);
    expect(selection.documents).toHaveLength(30);
    expect(
      selection.documents.every((entry) =>
        entry.specialties.some((area) => ['cardiology', 'pediatrics', 'neurology'].includes(area)),
      ),
    ).toBe(true);
  });
});
