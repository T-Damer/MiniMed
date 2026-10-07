import { describe, expect, it } from 'vitest';

import {
  attachmentBlobId,
  attachmentIsStale,
  attachPlan,
  parseAttachment,
  VaccinationAttachmentError,
} from '@/features/vaccination/vaccination-attachment';
import { getVaccinationCalendar } from '@/features/vaccination/vaccination-calendar';

const calendar = getVaccinationCalendar();

describe('vaccination plan attached to a patient card', () => {
  it('records the edition and keeps the first attach time on update', () => {
    const first = attachPlan(calendar, new Date('2026-10-07T09:00:00Z'));
    expect(first).toMatchObject({
      kind: 'minimed-vaccination-plan',
      calendarId: calendar.id,
      editionLine: 'по приказу № 1122н в ред. приказа № 677н',
      attachedAt: '2026-10-07T09:00:00.000Z',
    });
    const second = attachPlan(calendar, new Date('2026-11-01T09:00:00Z'), first);
    expect(second.attachedAt).toBe(first.attachedAt);
    expect(second.updatedAt).toBe('2026-11-01T09:00:00.000Z');
  });

  it('reads back what it wrote and flags another edition as stale', () => {
    const saved = attachPlan(calendar, new Date('2026-10-07T09:00:00Z'));
    const read = parseAttachment(JSON.stringify(saved));
    expect(read).toEqual(saved);
    expect(attachmentIsStale(read, calendar)).toBe(false);
    expect(attachmentIsStale({ ...read, editionLine: 'по приказу № 1122н' }, calendar)).toBe(true);
  });

  it('refuses damaged or foreign records instead of half-reading them', () => {
    const saved = attachPlan(calendar, new Date('2026-10-07T09:00:00Z'));
    for (const text of [
      'not json',
      '[]',
      JSON.stringify({ ...saved, kind: 'other' }),
      JSON.stringify({ ...saved, schemaVersion: 2 }),
      JSON.stringify({ ...saved, attachedAt: 'yesterday' }),
      JSON.stringify({ ...saved, extra: true }),
      JSON.stringify({ ...saved, calendarId: '' }),
    ]) {
      expect(() => parseAttachment(text), text).toThrow(VaccinationAttachmentError);
    }
  });

  it('is a patient file of the card', () => {
    expect(attachmentBlobId('patient-7')).toBe('vaccination-plan-patient-7');
  });
});
