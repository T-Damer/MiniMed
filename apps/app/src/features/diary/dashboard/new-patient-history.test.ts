import { describe, expect, it } from 'vitest';

import { writePastMeds } from '@/features/diary/dashboard/new-patient-history';
import type { PastMedication } from '@/features/diary/diary-med-history';

const med = (id: string, name: string): PastMedication => ({
  id,
  name,
  by: 'doctor',
  updatedAt: '2026-11-10T10:00:00.000Z',
});

describe('past treatment written after the patient is created', () => {
  it('writes every item under the new patient id, in order', async () => {
    const saved: string[] = [];
    const written = new Set<string>();
    const result = await writePastMeds(
      async (patientId, item) => {
        saved.push(`${patientId}:${item.name}`);
      },
      'newpatient',
      [med('a', 'Сертралин'), med('b', 'Амитриптилин')],
      written,
    );
    expect(result).toEqual({ kind: 'written' });
    expect(saved).toEqual(['newpatient:Сертралин', 'newpatient:Амитриптилин']);
  });

  it('says what failed, keeps what was written, and a retry writes only the rest', async () => {
    const saved: string[] = [];
    const written = new Set<string>();
    let broken = true;
    const save = async (_patientId: string, item: PastMedication): Promise<void> => {
      if (item.id === 'b' && broken) throw new Error('нет связи');
      saved.push(item.id);
    };
    const items = [med('a', 'Сертралин'), med('b', 'Амитриптилин'), med('c', 'Кветиапин')];
    const first = await writePastMeds(save, 'p1', items, written);
    expect(first).toEqual({ kind: 'failed', reason: 'нет связи', left: 2 });
    expect(saved).toEqual(['a']);
    broken = false;
    expect(await writePastMeds(save, 'p1', items, written)).toEqual({ kind: 'written' });
    expect(saved).toEqual(['a', 'b', 'c']);
  });

  it('writes nothing for an empty history', async () => {
    let calls = 0;
    const result = await writePastMeds(
      async () => {
        calls += 1;
      },
      'p1',
      [],
      new Set(),
    );
    expect(result).toEqual({ kind: 'written' });
    expect(calls).toBe(0);
  });
});
