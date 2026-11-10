import { describe, expect, it } from 'vitest';

import { parseNewPatientDrafts } from '@/features/diary/dashboard/new-patient-drafts';
import { emptyCareDraft, starterCareDraft } from '@/features/diary/diary-care-draft';

const base = {
  id: 'abc123',
  savedAt: '2026-11-09T10:00:00.000Z',
  label: 'Ёжик',
  emoji: '🦔',
  phone: '',
  birthDate: '',
  doctor: 'Д-р',
  note: '',
};

describe('kept new-patient drafts', () => {
  it('opens a draft saved before the form began empty, with its old pre-filled sections', () => {
    const text = JSON.stringify({
      v: 1,
      drafts: [{ ...base, screen: starterCareDraft() }],
    });
    const [draft] = parseNewPatientDrafts(text);
    expect(draft?.label).toBe('Ёжик');
    expect(draft?.screen.sections.length).toBeGreaterThan(0);
    // No past treatment was kept then: the form starts that step empty.
    expect(draft?.pastMeds).toBeUndefined();
  });

  it('keeps past treatment with an empty screen', () => {
    const pastMeds = [
      { id: 'h1', name: 'Сертралин', by: 'doctor', updatedAt: '2026-11-10T10:00:00.000Z' },
    ];
    const text = JSON.stringify({
      v: 1,
      drafts: [{ ...base, screen: emptyCareDraft(), pastMeds }],
    });
    const [draft] = parseNewPatientDrafts(text);
    expect(draft?.screen.sections).toEqual([]);
    expect(draft?.pastMeds).toEqual(pastMeds);
  });

  it('drops a draft whose screen or past treatment is not a list', () => {
    const text = JSON.stringify({
      v: 1,
      drafts: [
        { ...base, screen: { sections: 'x' } },
        { ...base, id: 'two', screen: emptyCareDraft(), pastMeds: 'x' },
        { ...base, id: 'three', screen: emptyCareDraft() },
      ],
    });
    expect(parseNewPatientDrafts(text).map((draft) => draft.id)).toEqual(['three']);
  });
});
