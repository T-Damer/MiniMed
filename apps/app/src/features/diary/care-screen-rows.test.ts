import { describe, expect, it } from 'vitest';

import { drugRows, sectionDetail, sectionTitle } from '@/features/diary/care-screen-rows';
import { emptyCareDraft, newCareSection } from '@/features/diary/diary-care-draft';

describe('the rows of the patient screen preview', () => {
  it('has none for an empty draft', () => {
    const rows = drugRows(emptyCareDraft().sections);
    expect(rows.timed).toEqual([]);
    expect(rows.asNeeded).toEqual([]);
  });

  it('groups medicines by part of the day and keeps «при необходимости» apart', () => {
    const morning = { ...newCareSection('drug'), title: 'Сертралин', dose: '50 мг' };
    const evening = {
      ...newCareSection('drug'),
      title: 'Кветиапин',
      times: [{ time: '21:00', meal: undefined }],
    };
    const needed = { ...newCareSection('drug'), title: 'Гидроксизин', asNeeded: true };
    const rows = drugRows([evening, needed, morning]);
    expect(rows.timed.map((group) => group.period)).toEqual(['morning', 'evening']);
    expect(rows.asNeeded).toEqual([needed.key]);
    expect(sectionDetail(morning)).toBe('50 мг · 08:00');
    expect(sectionDetail(needed)).toBe('при необходимости');
  });

  it('names a section the doctor has not titled yet', () => {
    expect(sectionTitle(newCareSection('drug'))).toBe('Выберите препарат');
    expect(sectionTitle({ ...newCareSection('score'), title: '' })).toBe('Самочувствие');
  });
});
