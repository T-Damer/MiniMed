import { createSignal } from 'solid-js';

import { formatRecordingDuration } from '@/features/asr/visit-recording';
import { recordingStartErrorMessage } from '@/features/conversations/recording-errors';
import {
  type ConversationRecorder,
  type ConversationRecording,
  markConversationAttached,
  readConversationAudio,
  recoverInterruptedRecordings,
  startConversationRecording,
} from '@/state/conversation-recordings';
import { appendEvent, type PatientEvent } from '@/state/patient-domain';
import { addPatientBlob, updatePatientVault } from '@/state/patient-vault';

/** One app-wide recording at a time; the bar and the attach dialog read these signals. */
const [recorder, setRecorder] = createSignal<ConversationRecorder | null>(null);
const [elapsedMs, setElapsedMs] = createSignal(0);
const [level, setLevel] = createSignal(0);
const [starting, setStarting] = createSignal(false);
const [error, setError] = createSignal('');
const [finished, setFinished] = createSignal<ConversationRecording | null>(null);

export const conversationSession = {
  recorder,
  elapsedMs,
  level,
  starting,
  error,
  finished,
  dismissFinished: () => setFinished(null),
  openFinished: (recording: ConversationRecording) => setFinished(recording),
  clearError: () => setError(''),
};

let ticker: number | undefined;

export async function startConversation(): Promise<void> {
  if (recorder() || starting()) return;
  setError('');
  setStarting(true);
  try {
    const next = await startConversationRecording((message) => setError(message));
    setRecorder(next);
    setElapsedMs(0);
    ticker = window.setInterval(() => {
      setElapsedMs(Date.now() - next.startedAt);
      setLevel(next.level());
    }, 200);
  } catch (cause) {
    setError(recordingStartErrorMessage(cause));
  } finally {
    setStarting(false);
  }
}

export async function stopConversation(): Promise<void> {
  const current = recorder();
  if (!current) return;
  if (ticker !== undefined) window.clearInterval(ticker);
  ticker = undefined;
  setRecorder(null);
  setLevel(0);
  try {
    setFinished(await current.stop());
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : 'Не удалось завершить запись.');
  }
}

/** On app start: anything still marked «recording» was cut off by a closed tab or a crash. */
export function recoverConversations(): void {
  void recoverInterruptedRecordings(recorder()?.id).catch(() =>
    setError('Не удалось проверить прерванные записи.'),
  );
}

export function conversationTitle(recording: ConversationRecording): string {
  return `Запись беседы, ${formatRecordingDuration(recording.durationMs)}`;
}

/**
 * Copies the audio into the patient's vault as a note event with its own blob. The source
 * recording stays in the inbox, marked as attached, until the doctor deletes it.
 */
export async function attachConversation(
  recording: ConversationRecording,
  patientId: string,
  episodeId: string | undefined,
): Promise<void> {
  const audio = await readConversationAudio(recording.id);
  const eventId = `conversation-${recording.id}`;
  const event: PatientEvent = {
    id: eventId,
    patientId,
    ...(episodeId ? { episodeId } : {}),
    kind: 'note',
    occurredAt: recording.startedAt,
    title: conversationTitle(recording),
    text:
      recording.status === 'interrupted'
        ? 'Аудиозапись беседы (запись прервалась, сохранена записанная часть).'
        : 'Аудиозапись беседы.',
    observations: [],
    immutable: false,
  };
  await addPatientBlob({
    id: `visit-recording-${eventId}`,
    patientId,
    mimeType: audio.type || 'audio/webm',
    bytes: new Uint8Array(await audio.arrayBuffer()),
  });
  await updatePatientVault((current) =>
    current.events.some((candidate) => candidate.id === eventId)
      ? current
      : appendEvent(current, event),
  );
  await markConversationAttached(recording.id, { patientId, eventId });
}
