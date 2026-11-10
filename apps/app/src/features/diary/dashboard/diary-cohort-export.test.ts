import { describe, expect, it } from 'vitest';

import { generateDemoDiary } from '@/features/diary/dashboard/demo-diary-data';
import {
  DEMO_PATIENTS,
  demoInvitation,
  loadQuestionnaireShapes,
} from '@/features/diary/dashboard/demo-patients';
import type { DiaryPlanItem } from '@/features/diary/diary-model';
import { cohortSheets, dailyDose, studyCode, studyDiaries } from './diary-cohort-export';
import { questionnaireSeries } from './diary-insights';

const NOW = new Date(2026, 9, 27, 15, 30);

async function demoDiary(index: number) {
  const spec = DEMO_PATIENTS[index];
  if (!spec) throw new Error('no spec');
  const id = `demopatient${index}`;
  const invitation = demoInvitation(spec, id, 'Доктор Демо', NOW);
  const shapes = await loadQuestionnaireShapes(['phq-9', 'gad-7']);
  const { entries } = generateDemoDiary({
    invitation,
    behavior: spec,
    questionnaires: shapes,
    now: NOW,
    days: spec.days,
    seed: 1,
  });
  const results = { v: 2 as const, invitation, entries };
  return {
    id,
    results,
    planHistory: [],
    quizzes: await questionnaireSeries(invitation, entries),
  };
}

describe('RESEARCH1 cohort export', () => {
  it('a study code is stable per study and diary and differs between studies', async () => {
    const first = await studyCode('Полипрагмазия-2027', 'abc');
    expect(first).toMatch(/^P-[0-9A-F]{8}$/u);
    expect(await studyCode('Полипрагмазия-2027', 'abc')).toBe(first);
    expect(await studyCode('Другое', 'abc')).not.toBe(first);
  });

  it('adds the intakes of a day into a daily dose when the units agree', () => {
    const item: DiaryPlanItem = {
      id: 'p1',
      name: 'Кветиапин',
      dose: '25 мг',
      times: [{ time: '08:00' }, { time: '21:00', dose: '50 мг' }],
    };
    expect(dailyDose(item)).toEqual({ amount: 75, unit: 'мг', intakes: 2 });
    expect(dailyDose({ ...item, asNeeded: true })).toBeUndefined();
    expect(
      dailyDose({ ...item, times: [{ time: '08:00' }, { time: '21:00', dose: '1 таблетка' }] }),
    ).toBeUndefined();
  });

  it('exports every diary under its code, with day numbers and no names or notes', async () => {
    const diaries = [await demoDiary(0), await demoDiary(1)];
    const sheets = await cohortSheets('study', diaries, NOW);
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      'Пациенты',
      'Назначения',
      'Приём по дням',
      'Измерения',
      'Опросники',
    ]);
    const [patients, plans, intakes, measures] = sheets;
    expect(patients?.rows).toHaveLength(2);
    const codes = new Set(patients?.rows.map((row) => row[0]));
    expect(codes.size).toBe(2);
    for (const sheet of sheets) {
      for (const row of sheet.rows) {
        expect(codes.has(row[0] as string)).toBe(true);
        expect(row.length).toBe(sheet.columns.length);
      }
    }
    expect(plans?.rows.length).toBeGreaterThan(0);
    expect(intakes?.rows.length).toBeGreaterThan(0);
    expect(measures?.rows.length).toBeGreaterThan(0);
    // No calendar dates, no demo labels, no free text from the entries.
    const text = JSON.stringify(sheets);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
    expect(text).not.toContain('Демо');
    for (const diary of diaries) {
      expect(text).not.toContain(diary.id);
      for (const entry of diary.results.entries) {
        if (entry.note && entry.note.length > 12) expect(text).not.toContain(entry.note);
      }
    }
  });
});

describe('RESEARCH1 who a study export takes', () => {
  const study = { id: 'st1', title: 'Полипрагмазия', protocol: '1', version: '2', text: 'Текст' };
  const patient = (label: string, answer?: object, withStudy = true) =>
    ({
      summary: { id: label },
      refused: 0,
      replica: {
        invitation: { id: label, ...(withStudy ? { study } : {}) },
        profile: { label },
        ...(answer ? { study: answer } : {}),
      },
    }) as unknown as Parameters<typeof studyDiaries>[0][number];

  it('only patients who agreed to the current version and did not withdraw', () => {
    const at = '2026-11-10T09:00:00Z';
    const picked = studyDiaries([
      patient('agreed', { study: 'st1', version: '2', status: 'accepted', at }),
      patient('old version', { study: 'st1', version: '1', status: 'accepted', at }),
      patient('declined', { study: 'st1', version: '2', status: 'declined', at }),
      patient('withdrawn', { study: 'st1', version: '2', status: 'withdrawn', at }),
      patient('no answer'),
      patient('no study', undefined, false),
      patient('Демо · agreed', { study: 'st1', version: '2', status: 'accepted', at }),
    ]).map((entry) => entry.summary.id);
    expect(picked).toEqual(['agreed']);
  });
});
