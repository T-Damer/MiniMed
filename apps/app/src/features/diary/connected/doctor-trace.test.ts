import { describe, expect, it } from 'vitest';

import { doctorTrace, removalOf } from '@/features/diary/connected/doctor-trace';
import { decodeDiaryResultsText, encodeDiaryResultsText } from '@/features/diary/diary-codec';
import {
  DIARY_FORMAT_VERSION,
  type DiaryInvitation,
  describeDiaryEntry,
  diaryTemplate,
  intakeMark,
  markedDose,
  parseDiaryEntry,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';

const NOW = Date.parse('2026-11-02T09:00:00Z');
const AT = '2026-11-02T09:00:00.000Z';

function diary(dose: string): DiaryInvitation {
  const template = diaryTemplate('care');
  return parseDiaryInvitation(
    {
      v: DIARY_FORMAT_VERSION,
      id: 'doctortrace1',
      template: 'care',
      title: template?.title,
      issuedAt: '2026-11-01T09:00:00.000Z',
      fields: template?.fields,
      plan: [
        {
          id: 'p1',
          name: 'Сертралин',
          dose,
          times: [{ time: '08:00' }, { time: '20:00', dose: '25 мг' }],
        },
      ],
    },
    NOW,
  );
}

describe('a mark keeps the dose it was taken at', () => {
  it('records the time’s own dose, else the item’s', () => {
    const item = diary('50 мг').plan?.[0];
    if (!item) throw new Error('no plan item');
    expect(intakeMark(item, true, '08:00')).toEqual({
      item: 'p1',
      done: true,
      slot: '08:00',
      dose: '50 мг',
    });
    expect(intakeMark(item, false, '20:00').dose).toBe('25 мг');
  });

  it('shows the recorded dose after the doctor raises it', () => {
    const before = diary('50 мг');
    const item = before.plan?.[0];
    if (!item) throw new Error('no plan item');
    const entry = parseDiaryEntry(
      before,
      {
        id: 'entry0001',
        at: '2026-11-01T08:05:00.000Z',
        values: { medication: intakeMark(item, true, '08:00') },
      },
      NOW,
    );
    const after = diary('100 мг');
    const value = entry.values['medication'] as Parameters<typeof markedDose>[1];
    expect(markedDose(after, value)).toBe('50 мг');
    expect(describeDiaryEntry(after, entry)).toContain('Сертралин 50 мг — выполнено');
    // A mark made before doses were recorded falls back to the plan.
    expect(markedDose(after, { item: 'p1', done: true, slot: '08:00' })).toBe('100 мг');
  });
});

describe('the dose travels with the mark', () => {
  it('survives the QR and text transport, with and without an intake time', async () => {
    const plan = diary('50 мг');
    const entries = [
      parseDiaryEntry(
        plan,
        {
          id: 'entry0001',
          at: '2026-11-01T08:05:00.000Z',
          values: { medication: { item: 'p1', done: true, slot: '08:00', dose: '50 мг' } },
        },
        NOW,
      ),
      parseDiaryEntry(
        plan,
        {
          id: 'entry0002',
          at: '2026-11-01T13:00:00.000Z',
          values: { medication: { item: 'p1', done: true, dose: '12,5 мг' } },
        },
        NOW,
      ),
    ];
    const text = await encodeDiaryResultsText({
      v: DIARY_FORMAT_VERSION,
      invitation: plan,
      entries,
    });
    const decoded = await decodeDiaryResultsText(text, NOW);
    expect(decoded.entries.map((entry) => entry.values['medication'])).toEqual([
      { item: 'p1', done: true, slot: '08:00', dose: '50 мг' },
      { item: 'p1', done: true, dose: '12,5 мг' },
    ]);
  });
});

describe('what the patient’s phone keeps of the doctor’s edits', () => {
  const plan = diary('50 мг');
  const entry = parseDiaryEntry(
    plan,
    {
      id: 'entry0001',
      at: '2026-11-01T08:05:00.000Z',
      values: { medication: { item: 'p1', done: true, slot: '08:00', dose: '50 мг' } },
    },
    NOW,
  );

  it('remembers a deleted mark: its words, time and intake', () => {
    expect(removalOf(plan, entry, AT)).toEqual({
      id: 'entry0001',
      at: '2026-11-01T08:05:00.000Z',
      line: describeDiaryEntry(plan, entry),
      item: 'p1',
      slot: '08:00',
      removedAt: AT,
    });
  });

  it('adds removals and a plan change, and forgets an entry brought back', () => {
    const removal = removalOf(plan, entry, AT);
    const patch = doctorTrace(
      {},
      {
        planBefore: plan,
        planAfter: diary('100 мг'),
        removals: [removal],
        restored: new Set(),
        at: AT,
      },
    );
    expect(patch).toEqual({
      planChange: { at: AT, lines: ['Сертралин: 50 мг → 100 мг'] },
      removedByDoctor: [removal],
    });
    const restored = doctorTrace(
      { removedByDoctor: [removal] },
      { planBefore: plan, planAfter: plan, removals: [], restored: new Set(['entry0001']), at: AT },
    );
    expect(restored).toEqual({ removedByDoctor: [] });
  });

  it('tells a fresh phone nothing and leaves an unchanged diary alone', () => {
    expect(
      doctorTrace(
        {},
        { planBefore: undefined, planAfter: plan, removals: [], restored: new Set(), at: AT },
      ),
    ).toBeUndefined();
    expect(
      doctorTrace(
        {},
        { planBefore: plan, planAfter: plan, removals: [], restored: new Set(), at: AT },
      ),
    ).toBeUndefined();
  });
});
