import { describe, expect, it } from 'vitest';

import {
  atTime,
  DEFAULT_QUESTIONNAIRE_DAYS,
  dayKey,
  dayPeriod,
  dayPlan,
  HEAT_PART_LABEL,
  type HeatPart,
  heatLevel,
  heatmapDays,
  heatParts,
  symptomLevel,
} from '@/features/diary/diary-care';
import { DiaryPartCollector, encodeDiaryResults } from '@/features/diary/diary-codec';
import { entryFingerprint } from '@/features/diary/diary-merge';
import {
  CARE_CHECKPOINTS,
  DIARY_FORMAT_VERSION,
  type DiaryEntry,
  DiaryFormatError,
  type DiaryInvitation,
  diaryTemplate,
  isCareDiary,
  parseDiaryEntry,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';

const DAY = '2026-10-20';
const NOW = new Date(2026, 9, 20, 22, 0);

function careInvitation(extra: Record<string, unknown> = {}): DiaryInvitation {
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
          times: [
            { time: '20:00', meal: 'after' },
            { time: '08:00', meal: 'after' },
          ],
        },
        { id: 'p2', name: 'Гидроксизин', dose: '25 мг', asNeeded: true },
      ],
      planTitle: 'Лекарства',
      checkpoints: [
        ...CARE_CHECKPOINTS,
        { id: 'phq', kind: 'questionnaire', label: 'PHQ-9', questionnaire: 'phq-9', everyDays: 7 },
      ],
      contacts: [{ kind: 'phone', value: '+7 900 000-00-00', label: 'Врач' }],
      tips: [{ id: 't1', target: 'p1', text: 'Запивайте водой.\nНе пропускайте вечерний приём.' }],
      consent: true,
      ...extra,
    },
    NOW.getTime(),
  );
}

function entry(invitation: DiaryInvitation, value: Record<string, unknown>): DiaryEntry {
  return parseDiaryEntry(invitation, value, NOW.getTime());
}

describe('care diary format', () => {
  it('reads timed intakes, checkpoints, contacts, tips and consent', () => {
    const invitation = careInvitation();
    expect(isCareDiary(invitation)).toBe(true);
    expect(invitation.plan?.[0]?.times?.map((time) => time.time)).toEqual(['08:00', '20:00']);
    expect(invitation.plan?.[1]?.asNeeded).toBe(true);
    expect(invitation.checkpoints?.map((checkpoint) => checkpoint.id)).toEqual([
      'am',
      'pm',
      'vitals',
      'phq',
    ]);
    expect(invitation.tips?.[0]?.text).toContain('\n');
    expect(invitation.consent).toBe(true);
  });

  it('refuses a bad time, an unknown checkpoint field and an http contact link', () => {
    const bad = (extra: Record<string, unknown>) => () => careInvitation(extra);
    expect(bad({ plan: [{ id: 'p1', name: 'X', times: [{ time: '8:00' }] }] })).toThrow(
      DiaryFormatError,
    );
    expect(
      bad({ checkpoints: [{ id: 'x', kind: 'score', label: 'X', fields: ['nope'] }] }),
    ).toThrow(DiaryFormatError);
    expect(bad({ contacts: [{ kind: 'link', value: 'http://example.org' }] })).toThrow(
      DiaryFormatError,
    );
  });

  it('keeps a long multi-line description and refuses an unknown checkpoint', () => {
    const invitation = careInvitation();
    const text = `${'Плохо спал. '.repeat(60)}\nУтром тревога.`;
    expect(
      entry(invitation, { id: 'note000001', at: atTime(DAY, '10:00'), values: { state: text } })
        .values['state'],
    ).toBe(text.trim());
    expect(() =>
      entry(invitation, {
        id: 'note000002',
        at: atTime(DAY, '10:00'),
        values: { wellbeing: 5 },
        check: 'nope',
      }),
    ).toThrow(DiaryFormatError);
  });
});

describe('day plan', () => {
  it('lists the day by time and marks taken, skipped, missed and late intakes', () => {
    const invitation = careInvitation();
    const entries = [
      entry(invitation, {
        id: 'dose000001',
        at: atTime(DAY, '08:10'),
        values: { medication: { item: 'p1', done: true, slot: '08:00' }, after: ['сонливость'] },
      }),
      entry(invitation, {
        id: 'mood000001',
        at: atTime(DAY, '09:05'),
        values: { wellbeing: 6 },
        check: 'am',
      }),
    ];
    const plan = dayPlan(invitation, entries, DAY, NOW);
    expect(plan.doses.map((task) => [task.key, task.state])).toEqual([
      ['p1@08:00', 'done'],
      ['p1@20:00', 'late'],
    ]);
    expect(plan.checks.map((task) => [task.key, task.state])).toEqual([
      ['am@09:00', 'done'],
      ['vitals@09:00', 'late'],
      ['pm@21:00', 'open'],
    ]);
    expect(plan.asNeeded[0]?.item.id).toBe('p2');
    // 2 intakes + 3 checks + the first PHQ-9 (never answered, so due).
    expect([plan.done, plan.total]).toEqual([2, 6]);

    const yesterday = dayPlan(invitation, entries, '2026-10-19', NOW);
    expect(yesterday.doses.every((task) => task.state === 'missed')).toBe(true);
  });

  it('asks for a questionnaire again after its period', () => {
    const invitation = careInvitation();
    const answered = entry(invitation, {
      id: 'phq0000001',
      at: atTime('2026-10-10', '12:00'),
      values: {},
      check: 'phq',
      answers: { 'phq9-01': 1, 'phq9-09': 0 },
    });
    const task = (day: string) => dayPlan(invitation, [answered], day, NOW).questionnaires[0];
    expect(task('2026-10-10')?.entry?.id).toBe('phq0000001');
    expect(task('2026-10-12')?.due).toBe(false);
    expect(task('2026-10-12')?.nextDay).toBe('2026-10-17');
    expect(task('2026-10-17')?.due).toBe(true);
    expect(DEFAULT_QUESTIONNAIRE_DAYS).toBe(7);
  });

  it('groups times of day', () => {
    expect(['06:30', '12:00', '18:00', '23:30'].map(dayPeriod)).toEqual([
      'morning',
      'day',
      'evening',
      'night',
    ]);
  });
});

describe('heatmap', () => {
  it('maps the share of the plan to five levels', () => {
    expect([heatLevel(0, 0, 0), heatLevel(0, 0, 3), heatLevel(0, 6, 1)]).toEqual([0, 2, 1]);
    expect([
      heatLevel(1, 6, 1),
      heatLevel(2, 6, 2),
      heatLevel(4, 6, 4),
      heatLevel(6, 6, 6),
    ]).toEqual([1, 2, 3, 4]);
  });

  it('counts days from issue to today and leaves the future empty', () => {
    const invitation = careInvitation();
    const entries = [
      entry(invitation, {
        id: 'dose000001',
        at: atTime(DAY, '08:10'),
        values: { medication: { item: 'p1', done: true, slot: '08:00' } },
      }),
    ];
    const days = heatmapDays(invitation, entries, '2026-10-19', '2026-10-21', NOW);
    expect(days.map((day) => [day.day, day.level, day.done])).toEqual([
      ['2026-10-19', 0, 0],
      ['2026-10-20', 1, 1],
      ['2026-10-21', 0, 0],
    ]);
    expect(dayKey(NOW)).toBe(DAY);
  });
});

describe('heatmap parts', () => {
  const invitation = careInvitation();
  const entries = [
    entry(invitation, {
      id: 'dose000001',
      at: atTime(DAY, '08:10'),
      values: { medication: { item: 'p1', done: true, slot: '08:00' } },
    }),
    entry(invitation, {
      id: 'score00001',
      at: atTime(DAY, '09:05'),
      values: { wellbeing: 7 },
      check: 'am',
    }),
    entry(invitation, {
      id: 'note000001',
      at: atTime(DAY, '12:00'),
      values: {},
      note: 'Лёгкая головная боль',
    }),
  ];
  const on = (...parts: HeatPart[]) =>
    heatmapDays(invitation, entries, DAY, DAY, NOW, new Set(parts))[0];
  const figures = (day: ReturnType<typeof on>) => [day?.done, day?.total, day?.entries, day?.level];

  it('lists only the parts the diary has, in display order', () => {
    expect(heatParts(invitation)).toEqual(['doses', 'scores', 'vitals', 'questionnaires', 'notes']);
    const bare = careInvitation({ plan: [], checkpoints: [] });
    expect(heatParts(bare)).toEqual(['notes']);
    const ended = careInvitation({
      checkpoints: CARE_CHECKPOINTS.map((item) => ({ ...item, ended: true })),
    });
    expect(heatParts(ended)).toEqual(['doses', 'notes']);
    expect(Object.keys(HEAT_PART_LABEL)).toHaveLength(6);
  });

  it('counts everything without a filter, with the full set and with an empty one', () => {
    const all = heatmapDays(invitation, entries, DAY, DAY, NOW)[0];
    expect(figures(all)).toEqual([2, 6, 3, 2]);
    expect(heatmapDays(invitation, entries, DAY, DAY, NOW, new Set(heatParts(invitation)))).toEqual(
      [all],
    );
    expect(heatmapDays(invitation, entries, DAY, DAY, NOW, new Set())).toEqual([all]);
  });

  it('counts the intakes alone', () => {
    expect(figures(on('doses'))).toEqual([1, 2, 1, 3]);
  });

  it('counts wellbeing scores and vitals separately', () => {
    expect(figures(on('scores'))).toEqual([1, 2, 1, 3]);
    expect(figures(on('vitals'))).toEqual([0, 1, 0, 0]);
  });

  it('counts a due questionnaire only when asked to', () => {
    expect(figures(on('questionnaires'))).toEqual([0, 1, 0, 0]);
    expect(figures(on('scores', 'vitals'))).toEqual([1, 3, 1, 2]);
  });

  it('counts free notes as entries without a plan', () => {
    expect(figures(on('notes'))).toEqual([0, 0, 1, 2]);
  });

  it('keeps days before the diary and in the future showing only the chosen entries', () => {
    const days = heatmapDays(
      invitation,
      entries,
      '2026-09-30',
      '2026-10-21',
      NOW,
      new Set<HeatPart>(['notes']),
    );
    expect(
      days.map((day) => [day.day, day.level, day.total]).filter(([, level]) => level !== 0),
    ).toEqual([[DAY, 2, 0]]);
  });

  it('files an entry of an unknown checkpoint under notes', () => {
    const stray = { ...(entries[1] as DiaryEntry), check: 'gone' };
    const [day] = heatmapDays(invitation, [stray], DAY, DAY, NOW, new Set<HeatPart>(['notes']));
    expect(day?.entries).toBe(1);
  });
});

describe('heatmap symptoms', () => {
  const invitation = careInvitation();
  const score = (id: string, time: string, check: string, wellbeing: number) =>
    entry(invitation, { id, at: atTime(DAY, time), values: { wellbeing }, check });

  it('grades low wellbeing scores, the lowest and the repeats', () => {
    expect([[], [4], [10], [3], [2], [1], [0]].map((scores) => symptomLevel(scores))).toEqual([
      0, 0, 0, 1, 2, 3, 4,
    ]);
    expect(symptomLevel([3, 3])).toBe(2);
    expect(symptomLevel([1, 2])).toBe(4);
    expect(symptomLevel([0, 0, 0])).toBe(4);
  });

  it('tints the day by its wellbeing scores', () => {
    const entries = [score('score00001', '09:00', 'am', 2), score('score00002', '21:00', 'pm', 8)];
    const [day] = heatmapDays(invitation, entries, DAY, DAY, NOW);
    expect(day?.symptoms).toBe(2);
    const calm = heatmapDays(invitation, [score('score00003', '09:00', 'am', 7)], DAY, DAY, NOW);
    expect(calm[0]?.symptoms).toBe(0);
  });

  it('does not count skipped intakes as symptoms', () => {
    const skipped = entry(invitation, {
      id: 'dose000001',
      at: atTime(DAY, '08:10'),
      values: { medication: { item: 'p1', done: false, slot: '08:00' } },
    });
    expect(heatmapDays(invitation, [skipped], DAY, DAY, NOW)[0]?.symptoms).toBe(0);
  });

  it('follows the part filter', () => {
    const entries = [score('score00001', '09:00', 'am', 1)];
    const without = heatmapDays(invitation, entries, DAY, DAY, NOW, new Set<HeatPart>(['doses']));
    expect(without[0]?.symptoms).toBe(0);
    const only = heatmapDays(invitation, entries, DAY, DAY, NOW, new Set<HeatPart>(['scores']));
    expect(only[0]?.symptoms).toBe(3);
  });
});

describe('care entries in transfer', () => {
  it('carry the intake slot, the checkpoint and questionnaire answers through QR parts', async () => {
    const invitation = careInvitation();
    const entries = [
      entry(invitation, {
        id: 'dose000001',
        at: atTime(DAY, '08:10'),
        values: { medication: { item: 'p1', done: false, slot: '08:00' } },
        note: 'Забыл',
      }),
      entry(invitation, {
        id: 'phq0000001',
        at: atTime(DAY, '12:00'),
        values: {},
        check: 'phq',
        answers: { 'phq9-01': 2, 'phq9-09': 1 },
      }),
    ];
    const parts = await encodeDiaryResults({ v: DIARY_FORMAT_VERSION, invitation, entries });
    const collector = new DiaryPartCollector();
    for (const part of parts) collector.add(part);
    const decoded = await collector.results(NOW.getTime());
    expect(decoded.entries).toEqual(entries);
    expect(entryFingerprint(entries[1] as DiaryEntry)).not.toBe(
      entryFingerprint({ ...(entries[1] as DiaryEntry), answers: { 'phq9-01': 1 } }),
    );
  });
});
