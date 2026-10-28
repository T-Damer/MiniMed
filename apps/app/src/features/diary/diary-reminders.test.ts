import { describe, expect, it } from 'vitest';

import { atTime, CARE_DOSE_FIELD } from '@/features/diary/diary-care';
import {
  CARE_CHECKPOINTS,
  DIARY_FORMAT_VERSION,
  type DiaryInvitation,
  type DiaryResults,
  diaryTemplate,
  parseDiaryEntry,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import {
  applyReminderAction,
  reminderMoments,
  reminderNotices,
  reminderSlots,
} from '@/features/diary/diary-reminders';

const NOW = new Date(2026, 9, 20, 9, 30);

function invitation(): DiaryInvitation {
  const template = diaryTemplate('care');
  return parseDiaryInvitation(
    {
      v: DIARY_FORMAT_VERSION,
      id: 'carediary01',
      template: 'care',
      title: template?.title,
      issuedAt: new Date(2026, 9, 1, 10, 0).toISOString(),
      fields: template?.fields,
      plan: [
        {
          id: 'p1',
          name: 'Сертралин',
          dose: '50 мг',
          times: [{ time: '08:00' }, { time: '21:00', dose: '25 мг' }],
        },
        {
          id: 'p2',
          name: 'Кветиапин',
          dose: '25 мг',
          times: [{ time: '21:00' }],
          course: [{ from: '2026-10-20', to: '2026-10-21' }],
        },
        { id: 'p3', name: 'Гидроксизин', asNeeded: true },
      ],
      checkpoints: CARE_CHECKPOINTS,
      consent: true,
    },
    NOW.getTime(),
  );
}

describe('diary reminders', () => {
  it('groups the open timed tasks of the next days by moment and skips what is done or past', () => {
    const plan = invitation();
    const taken = parseDiaryEntry(
      plan,
      {
        id: 'markentry0001',
        at: atTime('2026-10-20', '21:00'),
        values: { [CARE_DOSE_FIELD]: { item: 'p2', done: true, slot: '21:00' } },
      },
      NOW.getTime(),
    );
    const slots = reminderSlots(plan, [taken], NOW, 3);
    // Today 08:00 and 09:00 are past; at 21:00 Кветиапин is already ticked.
    expect(slots[0]).toEqual({
      at: atTime('2026-10-20', '21:00'),
      doses: [{ item: 'p1', slot: '21:00', name: 'Сертралин', dose: '25 мг' }],
      checks: ['Самочувствие вечером'],
    });
    expect(slots.map((slot) => slot.at)).toEqual([
      atTime('2026-10-20', '21:00'),
      atTime('2026-10-21', '08:00'),
      atTime('2026-10-21', '09:00'),
      atTime('2026-10-21', '21:00'),
      atTime('2026-10-22', '08:00'),
      atTime('2026-10-22', '09:00'),
      atTime('2026-10-22', '21:00'),
    ]);
    // The course of Кветиапин ends on the 21st; as-needed items never ring.
    expect(slots.at(-1)?.doses.map((dose) => dose.item)).toEqual(['p1']);
    expect(slots.flatMap((slot) => slot.doses).some((dose) => dose.item === 'p3')).toBe(false);
    expect(reminderMoments(slots)).toEqual(slots.map((slot) => slot.at));
  });

  it('keeps medicine names off the lock screen unless asked', () => {
    const slots = reminderSlots(invitation(), [], NOW, 2);
    const [discreet] = reminderNotices(slots, false);
    expect(discreet).toEqual({
      at: atTime('2026-10-20', '21:00'),
      title: 'Пора принять лекарство',
      body: 'Приём лекарств · Самочувствие вечером',
      doses: [
        { item: 'p1', slot: '21:00' },
        { item: 'p2', slot: '21:00' },
      ],
    });
    expect(reminderNotices(slots, true)[0]?.body).toBe(
      'Сертралин 25 мг · Кветиапин 25 мг · Самочувствие вечером',
    );
    const checkOnly = reminderNotices(slots, true).find((notice) => !notice.doses.length);
    expect(checkOnly?.title).toBe('Пора сделать отметку');
  });

  it('marks the intakes of «Принял» once, on the reminder’s day', () => {
    const plan = invitation();
    const results: DiaryResults = { v: DIARY_FORMAT_VERSION, invitation: plan, entries: [] };
    const at = atTime('2026-10-20', '21:00');
    const action = {
      diary: plan.id,
      at,
      takenAt: new Date(2026, 9, 20, 21, 4).toISOString(),
      doses: [
        { item: 'p1', slot: '21:00' },
        { item: 'p2', slot: '21:00' },
        { item: 'gone', slot: '21:00' },
      ],
    };
    const marked = applyReminderAction(results, action);
    expect(marked.entries.map((entry) => entry.values[CARE_DOSE_FIELD])).toEqual([
      { item: 'p1', done: true, slot: '21:00' },
      { item: 'p2', done: true, slot: '21:00' },
    ]);
    expect(marked.entries.every((entry) => entry.at === action.takenAt)).toBe(true);
    // Applied twice (the worker queued it while the diary was open): nothing new.
    expect(applyReminderAction(marked, action).entries).toHaveLength(2);
    // Pressed after midnight: the mark keeps the reminder's day.
    const late = applyReminderAction(results, {
      ...action,
      takenAt: new Date(2026, 9, 21, 0, 30).toISOString(),
    });
    expect(late.entries[0]?.at).toBe(at);
  });
});
