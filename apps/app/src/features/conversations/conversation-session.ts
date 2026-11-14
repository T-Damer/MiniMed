import { type Accessor, createSignal } from 'solid-js';

import { checkNativeModels, nativeSpeechReady } from '@/features/asr/native-model-install';
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
  transcriptLines,
} from '@/features/conversations/conversation-transcript';
import { startLoadMonitor } from '@/features/conversations/device-load';
import {
  type LiveStatus,
  type SpeechTranscriber,
  startSpeechTranscriber,
  type TranscriptSegment,
} from '@/features/conversations/live-transcription';
import { diagnoseMicrophoneFailure } from '@/features/conversations/microphone-access';
import { peaksOfSamples } from '@/features/conversations/recording-audio';
import {
  createSpeechEngine,
  type SpeechEngine,
  type SpeechEngineState,
} from '@/features/conversations/speech-engine';
import {
  type ConversationRecorder,
  type ConversationRecording,
  deleteConversationRecording,
  markConversationAttached,
  RECORDING_SAMPLE_RATE,
  readConversationAudio,
  readConversationRecording,
  readStoredSamples,
  recoverInterruptedRecordings,
  releaseStoredSamples,
  startConversationRecording,
  storedSampleSpan,
  updateConversationRecording,
} from '@/state/conversation-recordings';
import { isNativeSpeechSupported, recogniseNativePcm } from '@/state/native-transcriber';
import { appendEvent, type PatientEvent } from '@/state/patient-domain';
import { addPatientBlob, isPatientVaultUnlocked, updatePatientVault } from '@/state/patient-vault';
import { perfMark, perfSpan } from '@/state/perf-log';

type AsrRuntime = typeof import('@/features/asr/asr-models');

/** One app-wide recording at a time; the floating button and the window read these signals. */
const [recorder, setRecorder] = createSignal<ConversationRecorder | null>(null);
/** Recorded seconds, changed once a second (the time on the button needs no more). */
const [elapsedSeconds, setElapsedSeconds] = createSignal(0);
const [paused, setPaused] = createSignal(false);
const [starting, setStarting] = createSignal(false);
const [error, setError] = createSignal('');
/** The current error is a microphone refusal by Android itself: settings can fix it. */
const [errorOpensSettings, setErrorOpensSettings] = createSignal(false);
/** The recording whose sheet is open (just stopped, or opened from «Файлы» / a patient). */
const [finished, setFinished] = createSignal<ConversationRecording | null>(null);
/** Whether that sheet follows a «Стоп» (titled «Запись сохранена») or was opened from a list. */
const [finishedFrom, setFinishedFrom] = createSignal<'stopped' | 'list'>('stopped');
/** The recorder window over the app, opened from the floating button or the tools list. */
const [windowOpen, setWindowOpen] = createSignal(false);
/** The patient chosen in the window while recording: the recording goes to their card. */
const [linkedPatientId, setLinkedPatientId] = createSignal('');

/**
 * The text of one recording while it is held in memory: recognised segments, the state of their
 * encrypted autosave, and the recogniser's state. Lines are never logged.
 */
export interface ConversationTranscript {
  readonly segments: Accessor<readonly TranscriptSegment[]>;
  readonly lines: Accessor<readonly string[]>;
  readonly saveState: Accessor<TranscriptSaveState>;
  readonly status: Accessor<LiveStatus>;
  /** True from «Стоп» (or «Расшифровать») until the last audio is read and saved. */
  readonly settling: Accessor<boolean>;
  /** 0–1 of the recording turned into text, while a «Расшифровать» run reads it. */
  readonly progress: Accessor<number | null>;
}

interface TranscriptRun extends ConversationTranscript {
  readonly id: string;
  readonly setSegments: (segments: readonly TranscriptSegment[]) => void;
  readonly setStatus: (status: LiveStatus) => void;
  readonly setSettling: (settling: boolean) => void;
  readonly setProgress: (progress: number | null) => void;
  readonly saver: TranscriptSaver;
  transcriber?: SpeechTranscriber;
  /** Everything before this sample is text (or silence) — once that text is saved. */
  until: number;
  settled: Promise<void>;
}

const runs = new Map<string, TranscriptRun>();
const [activeRun, setActiveRun] = createSignal<TranscriptRun | undefined>();

let asrRuntime: AsrRuntime | undefined;
/** Speech runtime on demand: the first screen stays light, the model loads only for recordings. */
async function loadAsr(): Promise<AsrRuntime> {
  asrRuntime ??= await import('@/features/asr/asr-models');
  return asrRuntime;
}

/** What can recognise speech right now: GigaAM on Android once installed, else Whisper (REC2). */
export function speechEngineState(): SpeechEngineState {
  return {
    nativeSupported: isNativeSpeechSupported(),
    nativeReady: nativeSpeechReady(),
    whisperReady: asrRuntime?.liveRecognitionReady() ?? false,
  };
}

const speechEngine: SpeechEngine = createSpeechEngine({
  state: speechEngineState,
  recogniseNative: recogniseNativePcm,
  recogniseWhisper: async (samples) => (await loadAsr()).recogniseLivePcm(samples),
});

/**
 * Readies a recogniser for a recording: the native models are checked first, and the Whisper
 * runtime is loaded only when they are not there (the first screen stays light either way).
 */
async function prepareSpeechEngine(): Promise<void> {
  if (await checkNativeModels()) return;
  await loadAsr();
}

/**
 * Stored samples go once the text covering them is safely saved — or when there is no text to lose.
 * Unsaved text (no vault yet) keeps them, so «Расшифровать» can still produce it later.
 */
async function releaseCovered(run: TranscriptRun): Promise<void> {
  const state = run.saveState();
  const safe = state === 'saved' || (state === 'idle' && run.segments().length === 0);
  if (!safe || run.until <= 0) return;
  await releaseStoredSamples(run.id, run.until);
  await updateConversationRecording(run.id, { transcribedSamples: run.until });
}

function createRun(id: string, initial: readonly TranscriptSegment[] = []): TranscriptRun {
  const [segments, setSegments] = createSignal<readonly TranscriptSegment[]>(initial);
  const [saveState, setSaveState] = createSignal<TranscriptSaveState>('idle');
  const [status, setStatus] = createSignal<LiveStatus>('unavailable');
  const [settling, setSettling] = createSignal(false);
  const [progress, setProgress] = createSignal<number | null>(null);
  const run: TranscriptRun = {
    id,
    segments,
    lines: () => transcriptLines(segments()),
    saveState,
    status,
    settling,
    progress,
    setSegments,
    setStatus,
    setSettling,
    setProgress,
    until: 0,
    saver: createTranscriptSaver({
      save: async (next) => {
        const covered = run.until;
        const result = await saveDraftTranscript(id, next);
        if (result === 'saved') {
          await releaseStoredSamples(id, covered);
          await updateConversationRecording(id, { transcribedSamples: covered });
        }
        return result;
      },
      onState: setSaveState,
    }),
    settled: Promise.resolve(),
  };
  runs.set(id, run);
  return run;
}

function listenTo(
  run: TranscriptRun,
): Pick<Parameters<typeof startSpeechTranscriber>[0], 'onSegments' | 'onStatus' | 'onProgress'> {
  return {
    onSegments: (next) => {
      run.setSegments(next);
      run.saver.update(next);
    },
    onStatus: run.setStatus,
    onProgress: (until) => {
      run.until = until;
    },
  };
}

export const conversationSession = {
  recorder,
  /** Recorded milliseconds, pauses excluded (whole seconds). */
  elapsedMs: (): number => elapsedSeconds() * 1000,
  paused,
  starting,
  error,
  errorOpensSettings,
  finished,
  finishedFrom,
  windowOpen,
  linkedPatientId,
  /** The recogniser's state for the running recording. */
  liveStatus: (): LiveStatus => activeRun()?.status() ?? 'unavailable',
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
  /** The in-memory text of a recording made or read in this session, if its run is still held. */
  transcript: (recordingId: string): ConversationTranscript | undefined => runs.get(recordingId),
  openWindow: () => setWindowOpen(true),
  /**
   * The entry from the tools list: opens the recording window ready to start. The microphone stays
   * off until the doctor taps the big record button inside it.
   */
  prepare: () => setWindowOpen(true),
  closeWindow: () => setWindowOpen(false),
  linkPatient: (patientId: string): void => {
    setLinkedPatientId(patientId);
    const current = recorder();
    if (current) void updateConversationRecording(current.id, { patientId });
  },
  pause: (): void => {
    recorder()?.pause();
    perfMark('recorder.pause');
    setPaused(recorder()?.paused() ?? false);
  },
  resume: (): void => {
    recorder()?.resume();
    perfMark('recorder.resume');
    setPaused(recorder()?.paused() ?? false);
  },
  dismissFinished: () => {
    const recording = finished();
    setFinished(null);
    // The run may still be reading the tail of the audio; it is dropped once that is saved.
    const run = recording ? runs.get(recording.id) : undefined;
    if (run && !run.settling()) void run.settled.then(() => runs.delete(run.id));
  },
  /** Opens a recording's sheet from «Файлы», a patient's card or the notes inbox. */
  openFinished: (recording: ConversationRecording) => {
    setFinishedFrom('list');
    setFinished(recording);
  },
  /** Re-reads the open sheet's recording (attached, text progress) without closing it. */
  refreshFinished: async (): Promise<void> => {
    const open = finished();
    if (!open) return;
    const updated = await readConversationRecording(open.id);
    if (updated && finished()?.id === open.id) setFinished(updated);
  },
  clearError: () => {
    setError('');
    setErrorOpensSettings(false);
  },
};

let ticker: number | undefined;
let loadMonitor: ReturnType<typeof startLoadMonitor> | undefined;
/** Performance log: the recording as a running feature, so long frames during it are blamed on it. */
let endRecordingSpan: ((fields?: Readonly<Record<string, unknown>>) => void) | undefined;

/** Live text: the recorder's 16 kHz samples go straight to the transcriber, nothing is decoded. */
function beginLiveText(run: TranscriptRun, source: ConversationRecorder): void {
  loadMonitor = startLoadMonitor();
  const monitor = loadMonitor;
  void prepareSpeechEngine().catch(() => run.setStatus('failed'));
  const transcriber = startSpeechTranscriber({
    mode: 'live',
    available: speechEngine.available,
    recognise: speechEngine.recognise,
    overloaded: () => monitor.overloaded(),
    ...listenTo(run),
  });
  run.transcriber = transcriber;
  source.onSamples((samples) => transcriber.push(samples));
}

/**
 * After «Стоп»: lets the transcriber read what it still holds (unless it has deferred), makes the
 * final encrypted write and releases the samples that are text now. The window waits on `settled`.
 */
function settleRun(run: TranscriptRun): void {
  run.setSettling(true);
  run.settled = (async () => {
    try {
      await run.transcriber?.finish();
      await run.saver.flush();
      await releaseCovered(run);
    } finally {
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
    perfMark('recorder.start');
    endRecordingSpan = perfSpan('recorder.recording');
    setRecorder(next);
    setPaused(false);
    setElapsedSeconds(0);
    ticker = window.setInterval(() => {
      const seconds = Math.floor(next.elapsedMs() / 1000);
      if (seconds !== elapsedSeconds()) setElapsedSeconds(seconds);
    }, 250);
    const run = createRun(next.id);
    setActiveRun(run);
    beginLiveText(run, next);
    if (linkedPatientId())
      void updateConversationRecording(next.id, { patientId: linkedPatientId() });
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
  loadMonitor?.dispose();
  loadMonitor = undefined;
  const recordedSeconds = current.elapsedMs() / 1000;
  endRecordingSpan?.({ recordedS: recordedSeconds });
  endRecordingSpan = undefined;
  perfMark('recorder.stop', { recordedS: recordedSeconds });
  const run = activeRun();
  const patientId = linkedPatientId();
  setWindowOpen(false);
  setRecorder(null);
  setPaused(false);
  setActiveRun(undefined);
  setLinkedPatientId('');
  try {
    const recording = await current.stop();
    if (run) settleRun(run);
    setFinishedFrom('stopped');
    setFinished(recording);
    if (patientId && isPatientVaultUnlocked()) {
      // The patient was chosen while recording: the recording goes to their card by itself.
      void attachConversation(recording, patientId, undefined)
        .then(async () => {
          const updated = await readConversationRecording(recording.id);
          if (updated && finished()?.id === recording.id) setFinished(updated);
        })
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : 'Не удалось добавить запись в карту.'),
        );
    }
  } catch (cause) {
    run?.transcriber?.stop();
    run?.saver.cancel();
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

/** The text a recording has: this session's segments while held, else the encrypted draft/file. */
export async function loadConversationSegments(recording: ConversationRecording): Promise<{
  readonly segments: readonly TranscriptSegment[];
  readonly locked: boolean;
}> {
  const run = runs.get(recording.id);
  if (run) return { segments: run.segments(), locked: false };
  const stored = await readConversationTranscript(recording.id);
  return stored.status === 'found'
    ? { segments: stored.segments, locked: false }
    : { segments: [], locked: stored.status === 'locked' };
}

/** The text a recording has, as lines (forms and the psychiatric status read it like this). */
export async function loadConversationLines(
  recording: ConversationRecording,
): Promise<{ readonly lines: readonly string[]; readonly locked: boolean }> {
  const { segments, locked } = await loadConversationSegments(recording);
  return { lines: transcriptLines(segments), locked };
}

/**
 * Whether part of a recording still waits to be turned into text: stored samples remain, or the
 * recording was made before REC1 (no samples kept) and has no text yet.
 */
export async function recordingNeedsTranscript(recording: ConversationRecording): Promise<boolean> {
  const run = runs.get(recording.id);
  if (run?.settling()) return false;
  if (recording.samples !== undefined) return (await storedSampleSpan(recording.id)) !== null;
  const { segments, locked } = await loadConversationSegments(recording);
  return !locked && segments.length === 0;
}

/** Peaks for a recording that has none (made before REC1 or interrupted): decoded once, saved. */
export async function ensureRecordingPeaks(
  recording: ConversationRecording,
): Promise<readonly number[]> {
  if (recording.peaks && recording.peaks.length > 0) return recording.peaks;
  const asr = await loadAsr();
  const pcm = await asr.decodeToPcm16k(await readConversationAudio(recording.id));
  const peaks = peaksOfSamples(pcm, RECORDING_SAMPLE_RATE);
  await updateConversationRecording(recording.id, { peaks });
  return peaks;
}

/** Writes new text into the patient's copy too, when the recording is already in a card. */
async function refreshAttachedText(
  recording: ConversationRecording,
  segments: readonly TranscriptSegment[],
): Promise<void> {
  const attached = (await readConversationRecording(recording.id))?.attachedTo;
  if (!attached || segments.length === 0) return;
  await filePatientTranscript(recording.id, segments, attached.patientId);
  await updatePatientVault((current) => ({
    ...current,
    events: current.events.map((event) =>
      event.id === attached.eventId ? { ...event, text: transcriptEventText(segments) } : event,
    ),
  }));
}

/**
 * «Расшифровать»: reads what is not text yet — the kept 16 kHz samples, or for a recording made
 * before REC1 the decoded file — to its end, in the background. The model must be ready.
 */
export async function transcribeRecording(recording: ConversationRecording): Promise<void> {
  const existing = runs.get(recording.id);
  if (existing?.settling()) return existing.settled;
  await prepareSpeechEngine();
  if (!speechEngine.available()) throw new Error('Сначала загрузите модель расшифровки.');
  const { segments: before } = await loadConversationSegments(recording);
  const run = existing ?? createRun(recording.id, before);
  run.setSettling(true);
  run.setProgress(0);
  const endTranscribeSpan = perfSpan('asr.transcribe-file', {
    recordedS: recording.durationMs / 1000,
  });
  run.settled = (async () => {
    try {
      const span = await storedSampleSpan(recording.id);
      const total =
        recording.samples ?? Math.round((recording.durationMs / 1000) * RECORDING_SAMPLE_RATE);
      const startSample = span?.from ?? 0;
      const transcriber = startSpeechTranscriber({
        mode: 'request',
        available: speechEngine.available,
        recognise: speechEngine.recognise,
        initialSegments: run.segments(),
        startSample,
        ...listenTo(run),
      });
      run.transcriber = transcriber;
      const step = (at: number): void => run.setProgress(Math.min(1, at / Math.max(1, total)));
      if (span) {
        for await (const block of readStoredSamples(recording.id, span.from)) {
          // Hand over in 50 ms pieces, as live: the recogniser reads while the rest still loads.
          for (let offset = 0; offset < block.samples.length; offset += 16_000) {
            transcriber.push(block.samples.subarray(offset, offset + 16_000));
          }
          step(block.start + block.samples.length);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } else if (recording.samples === undefined) {
        // Made before REC1: no samples were kept, the file is decoded once.
        const asr = await loadAsr();
        const pcm = await asr.decodeToPcm16k(await readConversationAudio(recording.id));
        for (let offset = 0; offset < pcm.length; offset += 16_000) {
          transcriber.push(pcm.subarray(offset, offset + 16_000));
          if (offset % (RECORDING_SAMPLE_RATE * 30) === 0) {
            step(offset);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
      }
      await transcriber.finish();
      run.setProgress(1);
      await run.saver.flush();
      await releaseCovered(run);
      if (transcriber.status() === 'failed') {
        throw new Error('Не удалось расшифровать запись. Попробуйте ещё раз.');
      }
      await refreshAttachedText(recording, run.segments());
    } finally {
      endTranscribeSpan();
      run.setSettling(false);
      run.setProgress(null);
    }
  })();
  return run.settled;
}

/**
 * Copies the audio and its text into the patient's vault as a note event with its own files. The
 * source recording stays in «Файлы», marked as attached, until the doctor deletes it.
 */
export async function attachConversation(
  recording: ConversationRecording,
  patientId: string,
  episodeId: string | undefined,
): Promise<void> {
  // The tail of a just-stopped recording may still be read; wait so the card gets all of it.
  await runs.get(recording.id)?.settled;
  const [audio, { segments }] = await Promise.all([
    readConversationAudio(recording.id),
    loadConversationSegments(recording),
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
      segments.length > 0
        ? transcriptEventText(segments)
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
  if (segments.length > 0) await filePatientTranscript(recording.id, segments, patientId);
  await updatePatientVault((current) =>
    current.events.some((candidate) => candidate.id === eventId)
      ? current
      : appendEvent(current, event),
  );
  await markConversationAttached(recording.id, { patientId, eventId });
  await updateConversationRecording(recording.id, { patientId });
}

/**
 * Deletes a recording from this device. The text goes with it unless the recording was added to a
 * patient: then the card owns a copy of the audio and the text, and both stay.
 */
export async function removeConversation(recording: ConversationRecording): Promise<void> {
  runs.get(recording.id)?.transcriber?.stop();
  runs.delete(recording.id);
  await deleteConversationRecording(recording.id);
  if (!recording.attachedTo) await deleteConversationTranscript(recording.id);
}
