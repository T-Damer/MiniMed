import { PsyStatusDocumentSchema } from '@localmed/contracts';
import {
  acceptPsyStatusSuggestion,
  emptyPsyStatusDocument,
  fillPsyStatusFromTranscript,
  openPsyStatusSuggestions,
} from '@localmed/core/psy-status';
import { describe, expect, it } from 'vitest';

import {
  encodePsyStatusRecord,
  PSY_STATUS_NOTE_TITLE,
  psyStatusNoteEvent,
} from '@/features/psy-status/psy-status-record';
import { pastedTranscriptLines } from '@/features/psy-status/psy-status-session';

/** A made-up conversation; no real patient. */
const PASTED = `Врач: Как настроение?
Пациент: Настроение плохое, ничего не радует.

Пациент: Голоса не слышу.`;

describe('psy-status from pasted text', () => {
  it('proposes phrases with quotes and files only what was accepted', () => {
    const lines = pastedTranscriptLines(PASTED);
    expect(lines).toEqual([
      'Врач: Как настроение?',
      'Пациент: Настроение плохое, ничего не радует.',
      'Пациент: Голоса не слышу.',
    ]);
    const suggestions = fillPsyStatusFromTranscript(lines);
    expect(suggestions.map((suggestion) => suggestion.code)).toEqual([
      'mood-depressed',
      'perception-none',
    ]);

    const [mood] = suggestions;
    if (!mood) throw new Error('no proposal');
    const document = acceptPsyStatusSuggestion(emptyPsyStatusDocument(), mood, 'e1');
    expect(openPsyStatusSuggestions(document, suggestions).map((s) => s.code)).toEqual([
      'perception-none',
    ]);

    const event = psyStatusNoteEvent({
      id: 'psy-1',
      patientId: 'p1',
      document,
      occurredAt: '2026-11-05T10:00:00.000Z',
    });
    expect(event).toMatchObject({ kind: 'note', title: PSY_STATUS_NOTE_TITLE, patientId: 'p1' });
    expect(event.text).toContain('Эмоции и аффект: настроение устойчиво снижено');

    const record = JSON.parse(new TextDecoder().decode(encodePsyStatusRecord(document, 'rec-1')));
    expect(record.kind).toBe('minimed-psy-status');
    expect(record.recordingId).toBe('rec-1');
    const stored = PsyStatusDocumentSchema.parse(record.document);
    expect(stored.entries[0]?.quotes[0]).toMatchObject({
      startLine: 1,
      text: 'Настроение плохое',
    });
  });

  it('ignores empty text and refuses to file an empty status', () => {
    expect(pastedTranscriptLines('  \n  ')).toEqual([]);
    expect(() =>
      psyStatusNoteEvent({
        id: 'psy-2',
        patientId: 'p1',
        document: emptyPsyStatusDocument(),
        occurredAt: '2026-11-05T10:00:00.000Z',
      }),
    ).toThrow();
  });
});
