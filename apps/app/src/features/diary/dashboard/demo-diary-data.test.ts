import { describe, expect, it } from 'vitest';

import { scoreAssessment } from '@/features/assessments/assessment-engine';
import type { DoctorDiaries } from '@/features/diary/connected/doctor-workspace';
import { type DemoDiary, generateDemoDiary } from '@/features/diary/dashboard/demo-diary-data';
import {
  DEMO_LABEL_PREFIX,
  DEMO_PATIENTS,
  demoInvitation,
  loadQuestionnaireShapes,
  questionnaireShape,
  seedDemoPatients,
} from '@/features/diary/dashboard/demo-patients';
import { CARE_DOSE_FIELD, dayKey, dayPlan } from '@/features/diary/diary-care';
import {
  type DiaryEntry,
  type DiaryInvitation,
  type DiaryPlanValue,
  parseDiaryEntry,
} from '@/features/diary/diary-model';
import { loadDiaryQuestionnaire } from '@/features/diary/diary-questionnaires';

const NOW = new Date(2026, 9, 27, 15, 30);

async function build(
  index: number,
  seed = 1,
): Promise<{
  invitation: DiaryInvitation;
  diary: DemoDiary;
}> {
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
    seed,
  });
  return { invitation, diary };
}

function wellbeing(entries: readonly DiaryEntry[], from: string, to: string): number[] {
  return entries
    .filter(
      (entry) =>
        (entry.check === 'am' || entry.check === 'pm') &&
        dayKey(entry.at) >= from &&
        dayKey(entry.at) <= to,
    )
    .map((entry) => entry.values['wellbeing'] as number);
}

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

describe('demo diary data', () => {
  it('produces only entries the diary model accepts, in the past', async () => {
    for (const [index, spec] of DEMO_PATIENTS.entries()) {
      const { invitation, diary } = await build(index);
      expect(diary.entries.length).toBeGreaterThan(spec.days * 4);
      expect(new Set(diary.entries.map((entry) => entry.id)).size).toBe(diary.entries.length);
      for (const entry of diary.entries) {
        expect(parseDiaryEntry(invitation, entry, NOW.getTime())).toEqual(entry);
        expect(Date.parse(entry.at)).toBeLessThan(NOW.getTime());
        expect(entry.at >= invitation.issuedAt).toBe(true);
      }
      const sorted = diary.entries.map((entry) => entry.at).toSorted();
      expect(diary.entries.map((entry) => entry.at)).toEqual(sorted);
      expect(Date.parse(diary.consentAt)).toBeGreaterThan(Date.parse(invitation.issuedAt));
      expect(Date.parse(diary.consentAt)).toBeLessThan(Date.parse(diary.entries[0]?.at ?? ''));
    }
  });

  it('is deterministic for a seed and differs between seeds', async () => {
    const first = await build(0, 5);
    const again = await build(0, 5);
    const other = await build(0, 6);
    expect(again.diary).toEqual(first.diary);
    expect(other.diary.entries).not.toEqual(first.diary.entries);
  });

  it('marks doses against the plan: mostly taken, some skipped, scheduled slots only', async () => {
    let taken = 0;
    let skipped = 0;
    for (const [index] of DEMO_PATIENTS.entries()) {
      const { invitation, diary } = await build(index);
      for (const entry of diary.entries) {
        const value = entry.values[CARE_DOSE_FIELD] as DiaryPlanValue | undefined;
        if (!value) continue;
        const item = invitation.plan?.find((candidate) => candidate.id === value.item);
        expect(item).toBeDefined();
        if (item?.asNeeded) {
          expect(value.slot).toBeUndefined();
          expect(value.done).toBe(true);
        } else {
          expect(item?.times?.some((time) => time.time === value.slot)).toBe(true);
          if (value.done) taken += 1;
          else skipped += 1;
        }
        expect(dayKey(entry.at) >= dayKey(invitation.issuedAt)).toBe(true);
      }
    }
    expect(skipped).toBeGreaterThan(0);
    expect(taken / (taken + skipped)).toBeGreaterThan(0.9);
  });

  it('shows each trend in the wellbeing marks', async () => {
    const days = (spec: number, from: number, to: number): [string, string] => {
      const count = DEMO_PATIENTS[spec]?.days ?? 0;
      const day = (offset: number): string => {
        const date = new Date(NOW);
        date.setDate(date.getDate() - (count - 1) + offset);
        return dayKey(date);
      };
      return [day(from), day(to)];
    };
    const improving = (await build(0)).diary.entries;
    const early = wellbeing(improving, ...days(0, 0, 6));
    const late = wellbeing(improving, ...days(0, 21, 27));
    expect(mean(late) - mean(early)).toBeGreaterThan(1.5);

    const worsening = (await build(2)).diary.entries;
    const before = wellbeing(worsening, ...days(2, 0, 20));
    const last = wellbeing(worsening, ...days(2, 24, 27));
    expect(mean(before) - mean(last)).toBeGreaterThan(1.5);

    const fluctuating = (await build(1)).diary.entries;
    const series = wellbeing(fluctuating, ...days(1, 0, 34));
    expect(Math.max(...series) - Math.min(...series)).toBeGreaterThanOrEqual(4);

    const stable = wellbeing((await build(3)).diary.entries, ...days(3, 0, 20));
    expect(mean(stable)).toBeGreaterThan(6.5);
  });

  it('keeps vitals in a realistic range with diastolic below systolic', async () => {
    const { diary } = await build(1);
    const vitals = diary.entries.filter((entry) => entry.check === 'vitals');
    expect(vitals.length).toBeGreaterThan(15);
    for (const entry of vitals) {
      const { pulse, systolic, diastolic, spo2 } = entry.values as Record<string, number>;
      expect(pulse).toBeGreaterThanOrEqual(48);
      expect(pulse).toBeLessThanOrEqual(130);
      expect(systolic).toBeGreaterThan(diastolic as number);
      expect(spo2).toBeGreaterThanOrEqual(94);
      expect(spo2).toBeLessThanOrEqual(100);
    }
  });

  it('fills the choice and text sections of the owl and writes free notes in Russian', async () => {
    const { invitation, diary } = await build(1);
    const choice = invitation.checkpoints?.find((checkpoint) => checkpoint.kind === 'choice');
    const text = invitation.checkpoints?.find((checkpoint) => checkpoint.kind === 'text');
    expect(choice && text).toBeTruthy();
    const options = invitation.fields.find((field) => field.id === choice?.fields?.[0])?.options;
    const sleep = diary.entries.filter((entry) => entry.check === choice?.id);
    expect(sleep.length).toBeGreaterThan(15);
    for (const entry of sleep) {
      expect(options).toContain(entry.values[choice?.fields?.[0] ?? '']);
    }
    expect(
      new Set(sleep.map((entry) => entry.values[choice?.fields?.[0] ?? ''])).size,
    ).toBeGreaterThan(1);
    const stories = diary.entries.filter((entry) => entry.check === text?.id);
    expect(stories.length).toBeGreaterThan(15);
    const notes = diary.entries.filter((entry) => typeof entry.values['state'] === 'string');
    expect(notes.length).toBeGreaterThan(2);
    for (const entry of [...stories, ...notes]) {
      expect(JSON.stringify(entry.values)).toMatch(/[а-яё]/iu);
    }
  });

  it('scores questionnaires weekly; only the bear has an urgent item 9, once', async () => {
    const phq = await loadDiaryQuestionnaire('phq-9');
    for (const [index, spec] of DEMO_PATIENTS.entries()) {
      const { invitation, diary } = await build(index);
      const answered = diary.entries.filter((entry) => entry.answers);
      expect(answered.length).toBeGreaterThanOrEqual(2);
      let urgent = 0;
      for (const entry of answered) {
        const checkpoint = invitation.checkpoints?.find(
          (candidate) => candidate.id === entry.check,
        );
        const definition = await loadDiaryQuestionnaire(checkpoint?.questionnaire ?? 'phq-9');
        const scored = scoreAssessment(definition, entry.answers ?? {}, entry.at);
        expect(scored.ok).toBe(true);
        if (scored.ok && scored.value.alerts?.length) {
          urgent += 1;
          expect(entry.id).toBe(diary.alertEntryId);
        }
      }
      expect(urgent).toBe(spec.urgentAlert ? 1 : 0);
      expect(diary.alertEntryId !== undefined).toBe(spec.urgentAlert);
      // A week apart, give or take the time of day.
      const times = answered
        .filter((entry) => entry.check === 'q-phq-9')
        .map((entry) => Date.parse(entry.at));
      for (let position = 1; position < times.length; position += 1) {
        const gap = ((times[position] ?? 0) - (times[position - 1] ?? 0)) / 86_400_000;
        expect(gap).toBeGreaterThan(6);
        expect(gap).toBeLessThan(8);
      }
    }
    expect(phq.questions.length).toBe(10);
  });

  it('gives the day plan something to show on every day of the history', async () => {
    const { invitation, diary } = await build(0);
    const plan = dayPlan(invitation, diary.entries, dayKey(new Date(2026, 9, 20)), NOW);
    expect(plan.doses.length).toBe(2);
    expect(plan.done).toBeGreaterThan(2);
  });
});

describe('demo patients', () => {
  it('reads the alert item and the extra question from the questionnaire schema', async () => {
    const phq = questionnaireShape(await loadDiaryQuestionnaire('phq-9'));
    expect(phq.items).toHaveLength(9);
    expect(phq.alertItem).toBe(phq.items[8]);
    expect(phq.extras).toEqual(['phq9-difficulty']);
    const gad = questionnaireShape(await loadDiaryQuestionnaire('gad-7'));
    expect(gad.items).toHaveLength(7);
    expect(gad.alertItem).toBeUndefined();
  });

  it('issues every plan with the preset checkpoints, pseudonym labels and a past issue date', () => {
    expect(DEMO_PATIENTS).toHaveLength(4);
    for (const spec of DEMO_PATIENTS) {
      expect(spec.label.startsWith(DEMO_LABEL_PREFIX)).toBe(true);
      expect(spec.days).toBeGreaterThanOrEqual(21);
      expect(spec.days).toBeLessThanOrEqual(35);
      const invitation = demoInvitation(spec, 'demopatient01', 'Доктор Демо', NOW);
      const ids = (invitation.checkpoints ?? []).map((checkpoint) => checkpoint.id);
      expect(ids).toEqual(expect.arrayContaining(['am', 'pm', 'vitals', 'q-phq-9']));
      expect(Date.parse(invitation.issuedAt)).toBeLessThan(NOW.getTime());
    }
    const owl = demoInvitation(
      DEMO_PATIENTS[1] as (typeof DEMO_PATIENTS)[number],
      'demopatient01',
      'Д',
      NOW,
    );
    expect(owl.checkpoints?.map((checkpoint) => checkpoint.label)).toEqual(
      expect.arrayContaining(['Сон', 'Как прошёл день']),
    );
  });

  it('does not create a patient whose label already exists', async () => {
    const existing = DEMO_PATIENTS.map((spec, index) => ({
      summary: { id: `existing${index}` },
      replica: { profile: { label: spec.label } },
    }));
    const calls: string[] = [];
    const workspace = {
      isLoaded: () => true,
      patients: () => existing,
      createPatient: async () => {
        calls.push('create');
        return 'new';
      },
    } as unknown as DoctorDiaries;
    const ids = await seedDemoPatients(workspace, { count: 3 });
    expect(ids).toEqual(['existing0', 'existing1', 'existing2']);
    expect(calls).toEqual([]);
  });
});
