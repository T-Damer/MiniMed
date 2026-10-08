import { describe, expect, it } from 'vitest';

import { getVaccinationCalendar } from '@/features/vaccination/vaccination-calendar';
import {
  buildRecord,
  nextMarkState,
  parseRecord,
  recordBlobId,
  VaccinationRecordError,
  withMark,
  withMarks,
} from '@/features/vaccination/vaccination-record';

const calendar = getVaccinationCalendar();
const NOW = new Date('2026-10-07T09:00:00Z');

describe('vaccination marks', () => {
  it('cycles nothing, done, planned, nothing', () => {
    expect(nextMarkState(undefined)).toBe('done');
    expect(nextMarkState('done')).toBe('planned');
    expect(nextMarkState('planned')).toBeUndefined();
  });

  it('sets, re-marks and clears a vaccination without touching the others', () => {
    const done = withMark({}, 'n-01-1', 'done', '2026-01-11');
    expect(done).toEqual({ 'n-01-1': { state: 'done', date: '2026-01-11' } });
    // A tap changes the state and keeps the date the doctor noted.
    const planned = withMark(done, 'n-01-1', 'planned');
    expect(planned['n-01-1']).toEqual({ state: 'planned', date: '2026-01-11' });
    // A new date replaces it; `null` clears it.
    expect(withMark(planned, 'n-01-1', 'planned', null)['n-01-1']?.date).toBeNull();
    const two = withMark(done, 'n-02-1', 'done');
    expect(Object.keys(two)).toEqual(['n-01-1', 'n-02-1']);
    expect(withMark(two, 'n-01-1', undefined)).toEqual({ 'n-02-1': { state: 'done', date: null } });
  });

  it('marks several vaccinations at once and leaves dates already noted', () => {
    const start = withMark({}, 'n-01-1', 'planned', '2026-01-11');
    const next = withMarks(start, ['n-01-1', 'n-02-1'], 'done');
    expect(next['n-01-1']).toEqual({ state: 'done', date: '2026-01-11' });
    expect(next['n-02-1']).toEqual({ state: 'done', date: null });
  });
});

describe('vaccination record of a patient card', () => {
  it('reads back what it wrote', () => {
    const marks = withMark({}, 'n-05-1', 'done', '2026-04-10');
    const saved = buildRecord(calendar.id, marks, NOW);
    expect(saved).toMatchObject({
      kind: 'minimed-vaccination-record',
      calendarId: calendar.id,
      updatedAt: '2026-10-07T09:00:00.000Z',
    });
    expect(parseRecord(JSON.stringify(saved))).toEqual(saved);
  });

  it('refuses damaged or foreign records instead of half-reading them', () => {
    const saved = buildRecord(calendar.id, withMark({}, 'n-05-1', 'done'), NOW);
    for (const text of [
      'not json',
      '[]',
      JSON.stringify({ ...saved, kind: 'other' }),
      JSON.stringify({ ...saved, schemaVersion: 2 }),
      JSON.stringify({ ...saved, updatedAt: 'yesterday' }),
      JSON.stringify({ ...saved, extra: true }),
      JSON.stringify({ ...saved, calendarId: '' }),
      JSON.stringify({ ...saved, marks: { 'n-05-1': { state: 'skipped', date: null } } }),
      JSON.stringify({ ...saved, marks: { 'n-05-1': { state: 'done', date: '2026-02-30' } } }),
      JSON.stringify({ ...saved, marks: { 'n-05-1': { state: 'done' } } }),
    ]) {
      expect(() => parseRecord(text), text).toThrow(VaccinationRecordError);
    }
  });

  it('is a patient file of the card', () => {
    expect(recordBlobId('patient-7')).toBe('vaccination-record-patient-7');
  });
});
