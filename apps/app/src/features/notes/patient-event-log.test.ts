import { describe, expect, it } from 'vitest';

import { AUTOMATIC_TRANSCRIPT_LABEL } from '@/features/asr/visit-recording';
import {
  eventLogDetail,
  eventLogText,
  patientLogEntries,
} from '@/features/notes/patient-event-log';
import type { ConversationRecording } from '@/state/conversation-recordings';
import type { PatientEvent } from '@/state/patient-domain';

function event(id: string, occurredAt: string, patch: Partial<PatientEvent> = {}): PatientEvent {
  return {
    id,
    patientId: 'p1',
    kind: 'note',
    occurredAt,
    title: 'Запись',
    observations: [],
    immutable: false,
    ...patch,
  } as PatientEvent;
}

function recording(id: string, patch: Partial<ConversationRecording> = {}): ConversationRecording {
  return {
    id,
    startedAt: '2026-11-16T10:00:00.000Z',
    updatedAt: '2026-11-16T10:01:00.000Z',
    mimeType: 'audio/webm',
    status: 'stopped',
    durationMs: 9000,
    chunkCount: 1,
    bytes: 10,
    ...patch,
  };
}

describe('the patient log', () => {
  it('shows a recording and its text as one entry, newest first', () => {
    const text = event('e-rec', '2026-11-16T10:01:00.000Z', { title: 'Запись беседы, 00:09' });
    const note = event('e-note', '2026-11-16T12:00:00.000Z');
    const other = event('e-other', '2026-11-16T13:00:00.000Z', { patientId: 'p2' });
    const entries = patientLogEntries(
      'p1',
      [text, note, other],
      [
        recording('r1', { attachedTo: { patientId: 'p1', eventId: 'e-rec' } }),
        recording('r2', { patientId: 'p2' }),
      ],
    );
    expect(entries.map((entry) => [entry.kind, entry.id])).toEqual([
      ['event', 'e-note'],
      ['recording', 'recording-r1'],
    ]);
    expect(entries[1]?.event).toBe(text);
  });

  it('lists a recording chosen for the patient that has no text in the card yet', () => {
    const entries = patientLogEntries('p1', [], [recording('r1', { patientId: 'p1' })]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'recording', at: '2026-11-16T10:00:00.000Z' });
    expect(entries[0]?.event).toBeUndefined();
  });

  it('drops the fixed notice from a transcript and a detail that repeats the title', () => {
    expect(eventLogText(`${AUTOMATIC_TRANSCRIPT_LABEL}\n\nКак вы спали?`)).toBe('Как вы спали?');
    expect(eventLogText('Жалоб нет.')).toBe('Жалоб нет.');
    expect(eventLogText(undefined)).toBe('');
    expect(eventLogDetail('Запись беседы, 00:09', 'Запись беседы, 00:09')).toBe('');
    expect(eventLogDetail('Амоксициллин', 'Начало лечения')).toBe('Начало лечения');
  });
});
