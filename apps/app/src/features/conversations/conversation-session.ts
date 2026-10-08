import { type Accessor, createSignal } from 'solid-js';

import { formatRecordingDuration } from '@/features/asr/visit-recording';
import {
  createTranscriptSaver,
  deleteConversationTranscript,
  enableEncryptedVault,
  filePatientTranscript,
  readConversationTranscript,
  saveDraftTranscript,
  type TranscriptSaver,
  type TranscriptSaveState,
  transcriptEventText,
} from '@/features/conversations/conversation-transcript';
import {
  type LiveStatus,
  type LiveTranscriber,
  startLiveTranscriber,
} from '@/features/conversations/live-transcription';
import { diagnoseMicrophoneFailure } from '@/features/conversations/microphone-access';
import {
  type ConversationRecorder,
  type ConversationRecording,
  deleteConversationRecording,
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
/** The current error is a microphone refusal by Android itself: settings can fix it. */
const [errorOpensSettings, setErrorOpensSettings] = createSignal(false);
const [finished, setFinished] = createSignal<ConversationRecording | null>(null);
/** The live text window: expanded from the bar, optionally over the whole screen. */
const [windowOpen, setWindowOpen] = createSignal(false);
const [windowFullscreen, setWindowFullscreen] = createSignal(false);
const [liveStatus, setLiveStatus] = createSignal<LiveStatus>('unavailable');

/**
 * The text of one recording while it is held in memory: recognised lines, the state of their
 * encrypted autosave and whether the tail is still being read after «Стоп». Lines are never logged.
 */
export interface ConversationTranscript {
  readonly lines: Accessor<readonly string[]>;
  readonly saveState: Accessor<TranscriptSaveState>;
  /** True from «Стоп» until the last audio is read and the final write is done. */
  readonly settling: Accessor<boolean>;
}

interface TranscriptRun extends ConversationTranscript {
  readonly id: string;
  readonly setLines: (lines: readonly string[]) => void;
  readonly setSettling: (settling: boolean) => void;
  readonly saver: TranscriptSaver;
  live?: LiveTranscriber;
  /** Resolves once the live transcriber exists (or could not be created). */
  starting: Promise<void>;
  settled: Promise<void>;
}

const runs = new Map<string, TranscriptRun>();
const [activeRun, setActiveRun] = createSignal<TranscriptRun | undefined>();

function createRun(id: string): TranscriptRun {
  const [lines, setLines] = createSignal<readonly string[]>([]);
  const [saveState, setSaveState] = createSignal<TranscriptSaveState>('idle');
  const [settling, setSettling] = createSignal(false);
  const run: TranscriptRun = {
    id,
    lines,
    saveState,
    settling,
    setLines,
    setSettling,
    saver: createTranscriptSaver({
      save: (next) => saveDraftTranscript(id, next),
      onState: setSaveState,
    }),
    starting: Promise.resolve(),
    settled: Promise.resolve(),
  };
  runs.set(id, run);
  return run;
}

export const conversationSession = {
  recorder,
  elapsedMs,
  level,
  starting,
  error,
  errorOpensSettings,
  finished,
  windowOpen,
  windowFullscreen,
  liveStatus,
  /** Recognised lines of the recording that is running now. */
  liveLines: (): readonly string[] => activeRun()?.lines() ?? [],
  /** The autosave state of the running recording's text. */
  saveState: (): TranscriptSaveState => activeRun()?.saveState() ?? 'idle',
  /**
   * The doctor's tap on «Создать хранилище»: makes the vault encrypted, then writes the text that
   * could not be saved so far. Rejects with the vault's message when that fails.
   */
  enableTranscriptStorage: async (): Promise<void> => {
    const run = activeRun();
    await enableEncryptedVault();
    await run?.saver.retry();
  },
  /** The in-memory text of a recording made in this session, if its run is still held. */
  transcript: (recordingId: string): ConversationTranscript | undefined => runs.get(recordingId),
  openWindow: () => setWindowOpen(true),
  /**
   * The entry from the tools list: opens the recording window ready to start. The microphone stays
   * off until the doctor taps the big record button inside it.
   */
  prepare: () => setWindowOpen(true),
  closeWindow: () => {
    setWindowOpen(false);
    setWindowFullscreen(false);
  },
  toggleFullscreen: () => setWindowFullscreen((value) => !value),
  dismissFinished: () => {
    const recording = finished();
    setFinished(null);
    // The run may still be reading the tail of the audio; it is dropped once that is saved.
    const run = recording ? runs.get(recording.id) : undefined;
    if (run) void run.settled.then(() => runs.delete(run.id));
  },
  openFinished: (recording: ConversationRecording) => setFinished(recording),
  clearError: () => {
    setError('');
    setErrorOpensSettings(false);
  },
};

let ticker: number | undefined;

/** Live text needs the speech model; it loads on demand so the app's first screen stays light. */
async function beginLiveText(run: TranscriptRun, snapshot: () => Blob): Promise<void> {
  setLiveStatus('unavailable');
  try {
    const asr = await import('@/features/asr/asr-models');
    run.live = startLiveTranscriber({
      available: asr.liveRecognitionReady,
      snapshot,
      decode: asr.decodeToPcm16k,
      recognise: asr.recogniseLivePcm,
      onLines: (next) => {
        run.setLines(next);
        run.saver.update(next);
      },
      onStatus: (status) => {
        if (activeRun() === run) setLiveStatus(status);
      },
    });
  } catch {
    setLiveStatus('failed');
  }
}

/**
 * After «Стоп»: lets the transcriber read the audio that came in since its last step, then makes
 * the final encrypted write. Runs in the background; the attach dialog waits for `settled`.
 */
function settleRun(run: TranscriptRun): void {
  run.setSettling(true);
  run.settled = (async () => {
    try {
      await run.starting;
      await run.live?.finish();
      await run.saver.flush();
    } finally {
      run.saver.cancel();
      run.setSettling(false);
    }
  })();
}

export async function startConversation(): Promise<void> {
  if (recorder() || starting()) return;
  setError('');
  setErrorOpensSettings(false);
  setStarting(true);
  try {
    const next = await startConversationRecording((message) => setError(message));
    setRecorder(next);
    setElapsedMs(0);
    ticker = window.setInterval(() => {
      setElapsedMs(Date.now() - next.startedAt);
      setLevel(next.level());
    }, 200);
    const run = createRun(next.id);
    setActiveRun(run);
    run.starting = beginLiveText(run, () => next.snapshot());
  } catch (cause) {
    const failure = await diagnoseMicrophoneFailure(cause);
    setErrorOpensSettings(failure.openSettings);
    setError(failure.message);
  } finally {
    setStarting(false);
  }
}

export async function stopConversation(): Promise<void> {
  const current = recorder();
  if (!current) return;
  if (ticker !== undefined) window.clearInterval(ticker);
  ticker = undefined;
  const run = activeRun();
  setWindowOpen(false);
  setWindowFullscreen(false);
  setRecorder(null);
  setLevel(0);
  setLiveStatus('unavailable');
  setActiveRun(undefined);
  try {
    setFinished(await current.stop());
    if (run) settleRun(run);
  } catch (cause) {
    if (run) {
      run.saver.cancel();
      void run.starting.then(() => run.live?.stop());
    }
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

/** The text a recording has: this session's lines while held, else the encrypted draft or file. */
export async function loadConversationLines(
  recording: ConversationRecording,
): Promise<{ readonly lines: readonly string[]; readonly locked: boolean }> {
  const run = runs.get(recording.id);
  if (run) return { lines: run.lines(), locked: false };
  const stored = await readConversationTranscript(recording.id);
  return stored.status === 'found'
    ? { lines: stored.lines, locked: false }
    : { lines: [], locked: stored.status === 'locked' };
}

/**
 * Copies the audio and its text into the patient's vault as a note event with its own files. The
 * source recording stays in the inbox, marked as attached, until the doctor deletes it.
 */
export async function attachConversation(
  recording: ConversationRecording,
  patientId: string,
  episodeId: string | undefined,
): Promise<void> {
  // The tail of a just-stopped recording may still be read; wait so the card gets all of it.
  await runs.get(recording.id)?.settled;
  const [audio, { lines }] = await Promise.all([
    readConversationAudio(recording.id),
    loadConversationLines(recording),
  ]);
  const eventId = `conversation-${recording.id}`;
  const event: PatientEvent = {
    id: eventId,
    patientId,
    ...(episodeId ? { episodeId } : {}),
    kind: 'note',
    occurredAt: recording.startedAt,
    title: conversationTitle(recording),
    text:
      lines.length > 0
        ? transcriptEventText(lines)
        : recording.status === 'interrupted'
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
  if (lines.length > 0) await filePatientTranscript(recording.id, lines, patientId);
  await updatePatientVault((current) =>
    current.events.some((candidate) => candidate.id === eventId)
      ? current
      : appendEvent(current, event),
  );
  await markConversationAttached(recording.id, { patientId, eventId });
}

/**
 * Deletes a recording from this device. The text goes with it unless the recording was added to a
 * patient: then the card owns a copy of the audio and the text, and both stay.
 */
export async function removeConversation(recording: ConversationRecording): Promise<void> {
  await deleteConversationRecording(recording.id);
  if (!recording.attachedTo) await deleteConversationTranscript(recording.id);
}
