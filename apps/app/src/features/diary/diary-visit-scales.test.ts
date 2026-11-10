import { describe, expect, it } from 'vitest';

import {
  applyRevisions,
  EMPTY_REPLICA,
  replicaResults,
} from '@/features/diary/connected/diary-replica';
import { visitScaleSeries } from '@/features/diary/dashboard/visit-scale-series';
import {
  DIARY_FORMAT_VERSION,
  diaryTemplate,
  parseDiaryEntry,
  parseDiaryInvitation,
} from '@/features/diary/diary-model';
import {
  DIARY_CLINICIAN_SCALES,
  DIARY_QUESTIONNAIRES,
  loadDiaryQuestionnaire,
} from '@/features/diary/diary-questionnaires';
import {
  isClinicianScale,
  isVisitRecord,
  parseVisitScaleEntry,
  sortedVisitEntries,
  visitRecordId,
  visitScaleEntry,
} from '@/features/diary/diary-visit-scales';

const SLUG = 'hamilton-depression-rating-scale';
const template = diaryTemplate('care');
const invitation = parseDiaryInvitation({
  v: DIARY_FORMAT_VERSION,
  id: 'visitplan0001',
  template: 'care',
  title: template?.title,
  issuedAt: '2026-10-20T08:00:00.000Z',
  fields: template?.fields,
  plan: [{ id: 'p1', name: 'Сертралин', times: [{ time: '08:00' }] }],
  planTitle: 'Лекарства',
});

/** Every question of the scale answered with its first option (the bank's own ids and values). */
async function answers(pick: (index: number, values: readonly number[]) => number) {
  const definition = await loadDiaryQuestionnaire(SLUG);
  return Object.fromEntries(
    definition.questions.map((question, index) => {
      const options = question.responseOptions ?? definition.responseOptions;
      return [
        question.id,
        pick(
          index,
          options.map((option) => option.value),
        ),
      ];
    }),
  );
}

const revision = (id: string, author: string, payload: unknown, rev = 1) => ({
  id,
  rev,
  author,
  at: '2026-11-04T08:00:00.000Z',
  payload,
});

describe('the clinician scales list', () => {
  it('holds only scales of the tool bank that the patients’ list does not offer', () => {
    expect(DIARY_CLINICIAN_SCALES.map((scale) => scale.slug)).toEqual([SLUG]);
    for (const scale of DIARY_CLINICIAN_SCALES) {
      expect(DIARY_QUESTIONNAIRES.some((own) => own.slug === scale.slug)).toBe(false);
      expect(isClinicianScale(scale.slug)).toBe(true);
    }
    expect(isClinicianScale('phq-9')).toBe(false);
  });

  it('loads its questions from the bank', async () => {
    const definition = await loadDiaryQuestionnaire(SLUG);
    expect(definition.questions).toHaveLength(17);
  });
});

describe('a visit rating entry', () => {
  it('keeps the bank’s long question ids and names its scale', async () => {
    const given = await answers(() => 0);
    const entry = parseVisitScaleEntry(
      invitation,
      visitScaleEntry({
        id: 'rating000001',
        scale: SLUG,
        answers: given,
        at: '2026-11-03T12:00:00.000Z',
      }),
    );
    expect(entry).toMatchObject({ id: 'rating000001', visitScale: SLUG, values: {} });
    expect(Object.keys(entry.answers ?? {})).toHaveLength(17);
  });

  it('is refused without a scale, without answers, or mixed with a patient’s checkpoint', async () => {
    const given = await answers(() => 0);
    const valid = visitScaleEntry({
      id: 'rating000002',
      scale: SLUG,
      answers: given,
      at: '2026-11-03T12:00:00.000Z',
    });
    expect(() => parseVisitScaleEntry(invitation, { ...valid, visitScale: undefined })).toThrow();
    expect(() => parseDiaryEntry(invitation, { ...valid, answers: undefined })).toThrow();
    expect(() => parseDiaryEntry(invitation, { ...valid, visitScale: 'Не слаг!' })).toThrow();
    expect(() => parseDiaryEntry(invitation, { ...valid, visitScale: 7 })).toThrow();
    expect(() => parseDiaryEntry(invitation, { ...valid, check: 'am' })).toThrow();
    expect(() => parseDiaryEntry(invitation, { ...valid, answers: { q: 1.5 } })).toThrow();
  });

  it('is ordinary data for a client that does not know the field', () => {
    // An older parser ignores the key: the same entry without it is a plain answers entry.
    const entry = parseDiaryEntry(invitation, {
      id: 'rating000003',
      at: '2026-11-03T12:00:00.000Z',
      values: {},
      answers: { q1: 1 },
    });
    expect(entry.visitScale).toBeUndefined();
    expect(() => parseVisitScaleEntry(invitation, entry)).toThrow(/без шкалы/u);
  });
});

describe('visit ratings in the connected diary', () => {
  const plan = revision('plan', 'd:doctor0000001', { kind: 'plan', invitation });

  async function rating(id: string, at: string, given: Record<string, number>) {
    return visitScaleEntry({ id, scale: SLUG, answers: given, at });
  }

  it('are read from a doctor’s v- record, kept apart from the patient’s entries', async () => {
    const entry = await rating('rating000001', '2026-11-03T12:00:00.000Z', await answers(() => 1));
    const replica = applyRevisions(EMPTY_REPLICA, [
      plan,
      revision(visitRecordId('rating000001'), 'd:doctor0000001', { kind: 'visit-scale', entry }),
    ]);
    expect(replica.rejected).toBe(0);
    expect(sortedVisitEntries(replica.visitScales)).toHaveLength(1);
    expect(replica.entries.size).toBe(0);
    expect(replicaResults(replica)?.entries).toEqual([]);
    expect(isVisitRecord(visitRecordId('rating000001'))).toBe(true);
    expect(isVisitRecord('e-rating000001')).toBe(false);
  });

  it('are refused from a patient’s phone, in a wrong key, or inside the patient’s entries', async () => {
    const entry = await rating('rating000002', '2026-11-03T12:00:00.000Z', await answers(() => 1));
    const fromPatient = applyRevisions(EMPTY_REPLICA, [
      plan,
      revision(visitRecordId('rating000002'), 'p:device000001', { kind: 'visit-scale', entry }),
    ]);
    expect(fromPatient.visitScales).toBeUndefined();
    expect(fromPatient.rejected).toBe(1);
    const wrongKey = applyRevisions(EMPTY_REPLICA, [
      plan,
      revision(visitRecordId('rating000009'), 'd:doctor0000001', { kind: 'visit-scale', entry }),
    ]);
    expect(wrongKey.visitScales).toBeUndefined();
    expect(wrongKey.rejected).toBe(1);
    // A doctor’s rating cannot pose as a patient’s self-report either.
    const asEntry = applyRevisions(EMPTY_REPLICA, [
      plan,
      revision('e-rating000002', 'd:doctor0000001', { kind: 'entry', entry }),
    ]);
    expect(asEntry.entries.size).toBe(0);
    expect(asEntry.rejected).toBe(1);
  });

  it('can be removed and are listed oldest first', async () => {
    const early = await rating('rating000003', '2026-10-01T12:00:00.000Z', await answers(() => 2));
    const late = await rating('rating000004', '2026-11-01T12:00:00.000Z', await answers(() => 0));
    const both = applyRevisions(EMPTY_REPLICA, [
      plan,
      revision(visitRecordId('rating000004'), 'd:doctor0000001', {
        kind: 'visit-scale',
        entry: late,
      }),
      revision(visitRecordId('rating000003'), 'd:doctor0000001', {
        kind: 'visit-scale',
        entry: early,
      }),
    ]);
    expect(sortedVisitEntries(both.visitScales).map((one) => one.id)).toEqual([
      'rating000003',
      'rating000004',
    ]);
    const removed = applyRevisions(both, [
      revision(visitRecordId('rating000003'), 'd:doctor0000001', { kind: 'deleted' }, 2),
    ]);
    expect(sortedVisitEntries(removed.visitScales).map((one) => one.id)).toEqual(['rating000004']);
  });

  it('are scored with the bank’s own schema as the doctor’s series', async () => {
    const calm = parseVisitScaleEntry(
      invitation,
      await rating('rating000005', '2026-10-01T12:00:00.000Z', await answers(() => 0)),
    );
    const worse = parseVisitScaleEntry(
      invitation,
      await rating(
        'rating000006',
        '2026-11-01T12:00:00.000Z',
        await answers((_, values) => Math.max(...values)),
      ),
    );
    const series = await visitScaleSeries([worse, calm]);
    expect(series).toHaveLength(1);
    expect(series[0]?.title).toContain('оценка врача');
    expect(series[0]?.limitId).toBe(SLUG);
    expect(series[0]?.points.map((point) => point.total)).toEqual([0, 52]);
    expect(series[0]?.points[0]?.max).toBe(52);
    expect(series[0]?.points[0]?.answers).toHaveLength(17);
    // A scale this version does not list has nothing to score it with.
    const future = { ...calm, visitScale: 'some-future-scale' };
    expect(await visitScaleSeries([future])).toEqual([]);
  });
});
