import { describe, expect, it } from 'vitest';
import { isFullScreenRoute } from '@/app/full-screen-routes';
import { generateDemoDiary } from '@/features/diary/dashboard/demo-diary-data';
import {
  DEMO_PATIENTS,
  demoInvitation,
  loadQuestionnaireShapes,
} from '@/features/diary/dashboard/demo-patients';
import { questionnaireSeries } from '@/features/diary/dashboard/diary-insights';
import { INTAKE_CHART_ID, overviewSignals } from '@/features/diary/dashboard/patient-overview';
import type { DiaryEntry } from '@/features/diary/diary-model';
import { diariesPath, readNotesRoute } from '@/features/notes/notes-routing';

const NOW = new Date(2026, 9, 27, 15, 30);
const DAY = 86_400_000;

async function demo(index: number) {
  const spec = DEMO_PATIENTS[index];
  if (!spec) throw new Error('no spec');
  const invitation = demoInvitation(spec, `demopatient${index}`, 'Доктор Демо', NOW);
  const shapes = await loadQuestionnaireShapes(['phq-9', 'gad-7']);
  const diary = generateDemoDiary({
    invitation,
    behavior: spec,
    questionnaires: shapes,
    now: NOW,
    days: spec.days,
    seed: 1,
  });
  return { invitation, entries: diary.entries };
}

describe('patient overview', () => {
  it('leads with medicine intake and one signal per charted value and questionnaire', async () => {
    const { invitation, entries } = await demo(0);
    const questionnaires = await questionnaireSeries(invitation, entries);
    const signals = overviewSignals({ invitation, entries, questionnaires, devices: 1, now: NOW });
    const ids = signals.map((signal) => signal.id);
    expect(ids).toContain(INTAKE_CHART_ID);
    expect(ids).toContain('wellbeing');
    for (const series of questionnaires) expect(ids).toContain(series.checkpointId);
    // Every signal opens something; worrying ones come first.
    const order = { danger: 0, warn: 1, good: 2, default: 2 } as const;
    const ranks = signals.map((signal) => order[signal.tone]);
    expect(ranks).toEqual(ranks.toSorted((left, right) => left - right));
    expect(signals.every((signal) => 'chart' in signal.target || 'pair' in signal.target)).toBe(
      true,
    );
    // No raw counters: the old «N записей» card is gone.
    expect(signals.some((signal) => /запис/u.test(signal.title))).toBe(false);
  });

  it('asks to pair a phone and flags a quiet patient', async () => {
    const { invitation, entries } = await demo(1);
    const lastAt = Math.max(...entries.map((entry) => Date.parse(entry.at)));
    const later = new Date(lastAt + 3 * DAY + 3_600_000);
    const signals = overviewSignals({
      invitation,
      entries,
      questionnaires: [],
      devices: 0,
      now: later,
    });
    const quiet = signals.find((signal) => signal.id === 'quiet');
    expect(quiet?.title).toBe('Нет записей 3 дня');
    expect(quiet?.tone).toBe('warn');
    // Three silent days also leave the plan unmarked: that leads, the silence and pairing follow.
    expect(signals.findIndex((signal) => signal.id === 'quiet')).toBeLessThan(
      signals.findIndex((signal) => signal.tone === 'default' || signal.tone === 'good') === -1
        ? signals.length
        : signals.findIndex((signal) => signal.tone === 'default' || signal.tone === 'good'),
    );
    expect(signals.find((signal) => signal.id === 'pair')?.target).toEqual({ pair: true });
  });

  it('marks a value over its red line and shows the latest of each series', async () => {
    const { invitation } = await demo(0);
    const at = (daysAgo: number): string => new Date(NOW.getTime() - daysAgo * DAY).toISOString();
    const entry = (id: string, daysAgo: number, systolic: number): DiaryEntry => ({
      id,
      at: at(daysAgo),
      check: 'vitals',
      values: { systolic, diastolic: 80 },
    });
    const entries = [entry('e1', 3, 125), entry('e2', 1, 185)];
    const pressure = overviewSignals({
      invitation,
      entries,
      questionnaires: [],
      devices: 1,
      now: NOW,
    }).find((signal) => signal.id === 'pressure');
    expect(pressure?.tone).toBe('danger');
    expect(pressure?.value).toBe('Верхнее 185 · Нижнее 80');
    expect(pressure?.detail).toMatch(/за порогом 1 раз за неделю/u);
    expect(pressure?.target).toEqual({ chart: 'pressure' });
  });
});

describe('charts route', () => {
  it('opens the charts page, at one chart, as a full-screen route', () => {
    const id = 'abcdefghijkl0123';
    expect(diariesPath(id, 'charts')).toBe(`#/notes/diaries/${id}/charts`);
    expect(readNotesRoute(`#/notes/diaries/${id}/charts`)).toEqual({
      kind: 'diaries',
      patientId: id,
      view: 'charts',
    });
    expect(readNotesRoute(`#/notes/diaries/${id}/charts/q-phq-9`)).toEqual({
      kind: 'diaries',
      patientId: id,
      view: 'charts',
      chart: 'q-phq-9',
    });
    expect(isFullScreenRoute(`#/notes/diaries/${id}/charts/use-alcohol`)).toBe(true);
    expect(isFullScreenRoute(`#/notes/diaries/${id}`)).toBe(false);
  });
});
