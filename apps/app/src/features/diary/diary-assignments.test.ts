import { describe, expect, it } from 'vitest';

import {
  assignmentDue,
  assignmentPrintRows,
  assignmentScheduleWords,
  cleanSheet,
  weekdayOf,
  worksheetSheetProblem,
} from '@/features/diary/diary-assignments';
import { dayPlan, heatParts } from '@/features/diary/diary-care';
import {
  type CareDraft,
  careDraftFrom,
  careInvitation,
  newCareAssignment,
  starterCareDraft,
} from '@/features/diary/diary-care-draft';
import {
  DiaryFormatError,
  type DiaryInvitation,
  parseDiaryEntry,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import { planChanges } from '@/features/diary/plan-changes';
import { builtInWorksheetsFrom } from '@/features/worksheets/built-in-worksheets';
import seed from '@/features/worksheets/cbt-worksheets.ru.json';
import { worksheetPrintHtml } from '@/features/worksheets/worksheet-print';
import type { UserWorksheet } from '@/state/user-worksheet-format';

const builtIns = builtInWorksheetsFrom(seed);

function builtIn(id: string): UserWorksheet {
  const found = builtIns.find((worksheet) => worksheet.id === id);
  if (!found) throw new Error(id);
  return found;
}

function withAssignments(
  draft: CareDraft,
  assignments: CareDraft['assignments'],
  previous?: DiaryInvitation,
): DiaryInvitation {
  return careInvitation({
    id: 'carediary01',
    draft: { ...draft, ...(assignments ? { assignments } : {}) },
    doctor: 'Д-р',
    note: '',
    ...(previous ? { previous } : {}),
  });
}

const thoughts = {
  ...newCareAssignment(builtIn('cbt-thought-record'), '2026-11-02'),
  why: 'Чтобы увидеть, какие мысли поднимают тревогу',
};
const activity = {
  ...newCareAssignment(builtIn('cbt-activity-mood'), '2026-11-02'),
  repeat: 'days' as const,
  days: [1, 3, 5],
  time: '21:00',
};

describe('CBT assignments in the diary plan', () => {
  it('embeds the patient’s copy of each sheet with its schedule and memo', () => {
    const invitation = withAssignments(starterCareDraft(), [thoughts, activity]);
    expect(invitation.assignments?.map((one) => one.id)).toEqual(['w1', 'w2']);
    const [first, second] = invitation.assignments ?? [];
    expect(first?.worksheet.title).toBe('Запись мыслей');
    expect(first?.repeat).toBe('event');
    expect(first?.why).toContain('мысли');
    expect(second).toMatchObject({ repeat: 'days', days: [1, 3, 5], time: '21:00' });
    // The editor opens the same assignments again.
    const draft = careDraftFrom(invitation);
    expect(draft.assignments?.map((one) => [one.id, one.worksheet.id])).toEqual([
      ['w1', 'cbt-thought-record'],
      ['w2', 'cbt-activity-mood'],
    ]);
  });

  it('keeps a removed assignment as ended, so the entries made for it still load', () => {
    const first = withAssignments(starterCareDraft(), [thoughts, activity]);
    const entry = {
      id: 'entry000001',
      at: '2026-11-03T10:00:00.000Z',
      values: {},
      assignment: 'w1',
      sheet: { situation: 'Совещание', intensity: 70 },
    };
    expect(parseDiaryEntry(first, entry).sheet).toEqual({ situation: 'Совещание', intensity: 70 });
    const draft = careDraftFrom(first);
    const second = withAssignments(draft, draft.assignments?.slice(1), first);
    expect(second.assignments?.find((one) => one.id === 'w1')?.ended).toBe(true);
    expect(parseDiaryEntry(second, entry).assignment).toBe('w1');
    expect(planChanges(first, second)).toContain('Задание завершено: Запись мыслей');
    // A new assignment never takes the id of an ended one.
    const third = withAssignments(
      careDraftFrom(second),
      [...(careDraftFrom(second).assignments ?? []), thoughts],
      second,
    );
    expect(third.assignments?.map((one) => one.id).toSorted()).toEqual(['w1', 'w2', 'w3']);
  });

  it('is a key an older patient app skips: no new checkpoint kind, other keys untouched', () => {
    const invitation = withAssignments(starterCareDraft(), [thoughts]);
    const { assignments: _assignments, ...older } = invitation;
    expect(parseDiaryInvitation(older).checkpoints).toEqual(invitation.checkpoints);
    // The parser of the time ignores keys it does not know, as this one ignores a future key.
    expect(() => parseDiaryInvitation({ ...invitation, future: [{ id: 'x' }] })).not.toThrow();
  });

  it('refuses a broken assignment instead of showing half of it', () => {
    const invitation = withAssignments(starterCareDraft(), [thoughts]);
    const broken = (patch: Record<string, unknown>) =>
      parseDiaryInvitation({
        ...invitation,
        assignments: [{ ...invitation.assignments?.[0], ...patch }],
      });
    expect(() => broken({ repeat: 'hourly' })).toThrow(DiaryFormatError);
    expect(() => broken({ repeat: 'days', days: [] })).toThrow(/дни недели/u);
    expect(() => broken({ until: '2026-11-01' })).toThrow(/окончания/u);
    expect(() => broken({ worksheet: { title: 'x' } })).toThrow(/лист некорректен/u);
  });

  it('checks a worksheet entry for shape and leaves the columns to the fill form', () => {
    const invitation = withAssignments(starterCareDraft(), [thoughts]);
    const at = '2026-11-03T10:00:00.000Z';
    expect(() =>
      parseDiaryEntry(invitation, {
        id: 'entry000002',
        at,
        values: {},
        assignment: 'w9',
        sheet: { a: 'x' },
      }),
    ).toThrow(/неизвестное задание/u);
    expect(() =>
      parseDiaryEntry(invitation, { id: 'entry000002', at, values: {}, sheet: { a: 'x' } }),
    ).toThrow(/без задания/u);
    expect(() =>
      parseDiaryEntry(invitation, {
        id: 'entry000002',
        at,
        values: {},
        assignment: 'w1',
        sheet: { situation: 'x'.repeat(2001) },
      }),
    ).toThrow(DiaryFormatError);
    // A column the doctor has since dropped still loads.
    expect(
      parseDiaryEntry(invitation, {
        id: 'entry000002',
        at,
        values: {},
        assignment: 'w1',
        sheet: { gone: 'старая колонка' },
      }).sheet,
    ).toEqual({ gone: 'старая колонка' });
  });

  it('carries which texts were spoken and reserves a place for a later voice insight', () => {
    const invitation = withAssignments(starterCareDraft(), [thoughts]);
    const entry = parseDiaryEntry(invitation, {
      id: 'entry000003',
      at: '2026-11-03T10:00:00.000Z',
      values: {},
      assignment: 'w1',
      sheet: { situation: 'Сказала голосом' },
      spoken: [{ target: 'situation', seconds: 12.4, engine: 'whisper-base', edited: true }],
      insights: [
        {
          target: 'situation',
          simplified: 'Говорила голосом',
          tone: [{ label: 'спокойно', spans: [{ from: 0, to: 7 }] }],
          model: 'future-model',
          at: '2026-11-03T10:01:00.000Z',
        },
      ],
    });
    expect(entry.spoken).toEqual([
      { target: 'situation', seconds: 12, engine: 'whisper-base', edited: true },
    ]);
    expect(entry.insights?.[0]?.tone[0]?.label).toBe('спокойно');
    expect(() =>
      parseDiaryEntry(invitation, {
        id: 'entry000004',
        at: '2026-11-03T10:00:00.000Z',
        values: {},
        note: 'x',
        spoken: [{ target: '#note', seconds: 0, engine: 'whisper-base' }],
      }),
    ).toThrow(/голосе/u);
  });
});

describe('the day of an assignment', () => {
  it('asks for a daily or weekday sheet and counts it; a «when it happens» sheet only shows', () => {
    const invitation = withAssignments(starterCareDraft(), [thoughts, activity]);
    const [record, mood] = invitation.assignments ?? [];
    if (!record || !mood) throw new Error('assignments');
    expect(weekdayOf('2026-11-09')).toBe(1);
    expect(assignmentDue(mood, '2026-11-09')).toBe(true);
    expect(assignmentDue(mood, '2026-11-10')).toBe(false);
    expect(assignmentDue(record, '2026-11-09')).toBe(false);
    expect(assignmentScheduleWords(mood)).toBe('Пн, Ср, Пт в 21:00');
    expect(assignmentScheduleWords(record)).toBe('Когда случится');

    const now = new Date('2026-11-09T22:30:00');
    const empty = dayPlan(invitation, [], '2026-11-09', now);
    const before = empty.total;
    expect(empty.assignments.map((task) => [task.assignment.id, task.due, task.state])).toEqual([
      ['w1', false, 'open'],
      ['w2', true, 'late'],
    ]);
    const entry = parseDiaryEntry(
      invitation,
      {
        id: 'entry000005',
        at: new Date('2026-11-09T21:05:00').toISOString(),
        values: {},
        assignment: 'w2',
        sheet: { activity: 'Прогулка', mood: 6 },
      },
      now.getTime(),
    );
    const filled = dayPlan(invitation, [entry], '2026-11-09', now);
    expect(filled.total).toBe(before);
    expect(filled.done).toBe(empty.done + 1);
    expect(filled.assignments[1]?.state).toBe('done');
    // A worksheet entry is not a free note.
    expect(filled.notes).toEqual([]);
    expect(heatParts(invitation)).toContain('assignments');
  });
});

describe('filling a worksheet', () => {
  const sheet = builtIn('cbt-thought-record');

  it('checks each cell against its column', () => {
    expect(worksheetSheetProblem(sheet, {})).toBe('Заполните хотя бы одно поле.');
    expect(worksheetSheetProblem(sheet, {}, 'только заметка')).toBeUndefined();
    expect(worksheetSheetProblem(sheet, { intensity: 140 })).toBe('«Сила эмоции»: от 0 до 100.');
    expect(worksheetSheetProblem(sheet, { situation: 'Совещание', intensity: 70 })).toBeUndefined();
    expect(cleanSheet(sheet, { situation: '  Совещание ', intensity: 70, emotion: '' })).toEqual({
      situation: 'Совещание',
      intensity: 70,
    });
  });

  it('prints the patient’s rows into the sheet, by hour for an hours sheet', () => {
    const hours = builtIn('cbt-activity-mood');
    const rows = assignmentPrintRows([
      {
        id: 'entry000006',
        at: new Date('2026-11-09T14:10:00').toISOString(),
        values: {},
        assignment: 'w2',
        sheet: { activity: 'Обед с сестрой', mood: 7 },
        note: 'Было легче, чем думала',
      },
    ]);
    const html = worksheetPrintHtml(hours, rows);
    expect(html).toContain('Дата: 09.11.2026');
    expect(html).toMatch(/<td>14:00<\/td><td>Обед с сестрой<\/td><td>7<\/td>/u);
    expect(html).toContain('<th>Что ещё важно</th>');
    expect(html).toContain('Было легче, чем думала');
  });
});
