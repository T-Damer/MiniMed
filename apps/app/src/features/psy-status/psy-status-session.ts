import type { PsyStatusDocument, PsyStatusSuggestion } from '@localmed/contracts';
import {
  emptyPsyStatusDocument,
  fillPsyStatusFromTranscript,
  openPsyStatusSuggestions,
} from '@localmed/core/psy-status';
import { createMemo, createRoot, createSignal } from 'solid-js';

import {
  conversationSession,
  conversationTitle,
  loadConversationLines,
} from '@/features/conversations/conversation-session';
import { listConversationRecordings } from '@/state/conversation-recordings';
import { PATIENT_VAULT_LOCK_EVENT } from '@/state/patient-vault';

/**
 * The psychiatric status being written (PSY1) and the conversation it is filled from. It stays in
 * memory for this app session, so leaving the screen and coming back keeps the work; it holds
 * patient words, so it is dropped the moment the patient vault locks and is never written to
 * ordinary storage or logs. The doctor's «Сохранить» files it into the chosen patient's card.
 */

export interface PsyStatusTranscript {
  readonly lines: readonly string[];
  /** What the doctor sees as the source: «Запись беседы, 12:04» or «Вставленный текст». */
  readonly label: string;
  readonly recordingId?: string;
}

function createStore() {
  const [document, setDocument] = createSignal<PsyStatusDocument>(emptyPsyStatusDocument());
  const [transcript, setTranscript] = createSignal<PsyStatusTranscript | undefined>();
  const [patientId, setPatientId] = createSignal('');
  const suggestions = createMemo<readonly PsyStatusSuggestion[]>(() => {
    const current = transcript();
    return current ? fillPsyStatusFromTranscript(current.lines) : [];
  });
  const open = createMemo(() => openPsyStatusSuggestions(document(), suggestions()));
  const reset = (): void => {
    setDocument(emptyPsyStatusDocument());
    setTranscript(undefined);
    setPatientId('');
  };
  if (typeof window !== 'undefined') window.addEventListener(PATIENT_VAULT_LOCK_EVENT, reset);
  return {
    document,
    setDocument,
    transcript,
    setTranscript,
    patientId,
    setPatientId,
    suggestions,
    openSuggestions: open,
    reset,
  };
}

export const psyStatusSession = createRoot(createStore);

/** Reads a conversation recording's text into the session; false when it has no text (yet). */
export async function loadPsyStatusRecording(recordingId: string): Promise<boolean> {
  if (psyStatusSession.transcript()?.recordingId === recordingId) return true;
  const recording = (await listConversationRecordings()).find((item) => item.id === recordingId);
  if (!recording) return false;
  const held = conversationSession.transcript(recordingId);
  const lines = held ? held.lines() : (await loadConversationLines(recording)).lines;
  if (lines.length === 0) return false;
  psyStatusSession.setTranscript({ lines, label: conversationTitle(recording), recordingId });
  if (recording.attachedTo && !psyStatusSession.patientId()) {
    psyStatusSession.setPatientId(recording.attachedTo.patientId);
  }
  return true;
}

/** Pasted text as transcript lines: every non-empty line, as typed. */
export function pastedTranscriptLines(text: string): readonly string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
}

export function takePsyStatusText(text: string): boolean {
  const lines = pastedTranscriptLines(text);
  if (lines.length === 0) return false;
  psyStatusSession.setTranscript({ lines, label: 'Вставленный текст' });
  return true;
}
