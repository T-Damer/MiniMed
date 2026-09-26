import type {
  NativeRecordingResult,
  NativeTranscriptionProgress,
  NativeTranscriptionResult,
} from '@localmed/contracts';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { Heading } from '@/components/Text';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import {
  createVisitTranscriptEvent,
  formatRecordingDuration,
  transcriptSpeakerIds,
  visitRecordingBlobId,
  visitTranscriptText,
} from '@/features/asr/visit-recording';
import { DownloadProgress } from '@/features/setup/DownloadProgress';
import {
  deleteNativeRecording,
  ensureNativeTranscriptionModels,
  getNativeTranscriptionModelStatus,
  isNativeTranscriberAvailable,
  readNativeRecording,
  requestNativeMicrophonePermission,
  startNativeRecording,
  stopNativeRecording,
  transcribeNativeRecording,
  watchNativeTranscription,
} from '@/state/native-transcriber';
import { appendEvent, type PatientVaultSnapshot } from '@/state/patient-domain';
import { addPatientBlob, updatePatientVault } from '@/state/patient-vault';
import '@/styles/visit-recorder.css';

type Phase =
  | { readonly kind: 'checking' }
  | { readonly kind: 'models-missing'; readonly bytesTotal: number }
  | { readonly kind: 'downloading'; readonly bytesReady: number; readonly bytesTotal: number }
  | { readonly kind: 'ready' }
  | { readonly kind: 'recording'; readonly startedAt: number }
  | {
      readonly kind: 'transcribing';
      readonly recording: NativeRecordingResult;
      readonly progress: NativeTranscriptionProgress | null;
    }
  | {
      readonly kind: 'review';
      readonly recording: NativeRecordingResult;
      readonly result: NativeTranscriptionResult;
    }
  | { readonly kind: 'saving' };

const STAGE_LABEL: Readonly<Record<NativeTranscriptionProgress['stage'], string>> = {
  preparing: 'Готовим аудио',
  diarizing: 'Разделяем говорящих',
  transcribing: 'Распознаём речь',
  finalizing: 'Собираем расшифровку',
};

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_048_576)} МБ`;
}

function eventId(): string {
  return `event-${crypto.randomUUID()}`;
}

/** Android visit dictaphone: record, split speakers and recognise speech locally. */
export function VisitRecorderPanel(props: {
  readonly patientId: string;
  readonly episodeId: string;
  readonly onSaved: (snapshot: PatientVaultSnapshot) => void;
}): JSX.Element {
  const [phase, setPhase] = createSignal<Phase>({ kind: 'checking' });
  const [error, setError] = createSignal('');
  const [consent, setConsent] = createSignal(false);
  const [elapsedMs, setElapsedMs] = createSignal(0);
  const [speakerNames, setSpeakerNames] = createSignal<Record<string, string>>({});
  const [transcript, setTranscript] = createSignal('');
  const [edited, setEdited] = createSignal(false);
  let timer: number | undefined;

  const refreshModels = async (): Promise<void> => {
    try {
      const status = await getNativeTranscriptionModelStatus();
      setPhase(
        status.ready
          ? { kind: 'ready' }
          : { kind: 'models-missing', bytesTotal: status.bytesTotal - status.bytesReady },
      );
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось проверить модели распознавания.'));
      setPhase({ kind: 'models-missing', bytesTotal: 0 });
    }
  };

  onMount(() => void refreshModels());
  onCleanup(() => window.clearInterval(timer));

  const downloadModels = async (): Promise<void> => {
    setError('');
    setPhase({ kind: 'downloading', bytesReady: 0, bytesTotal: 1 });
    try {
      const status = await ensureNativeTranscriptionModels((progress) =>
        setPhase({ kind: 'downloading', ...progress }),
      );
      setPhase(status.ready ? { kind: 'ready' } : { kind: 'models-missing', bytesTotal: 0 });
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось загрузить модели распознавания.'));
      await refreshModels();
    }
  };

  const start = async (): Promise<void> => {
    setError('');
    try {
      if (!(await requestNativeMicrophonePermission())) {
        setError('Нет доступа к микрофону. Разрешите его в настройках Android.');
        return;
      }
      await startNativeRecording();
      const startedAt = Date.now();
      setElapsedMs(0);
      timer = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
      setPhase({ kind: 'recording', startedAt });
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось начать запись.'));
    }
  };

  const transcribe = async (recording: NativeRecordingResult): Promise<void> => {
    setPhase({ kind: 'transcribing', recording, progress: null });
    const listener = await watchNativeTranscription((progress) =>
      setPhase({ kind: 'transcribing', recording, progress }),
    );
    try {
      const result = await transcribeNativeRecording(recording.filePath);
      const names = Object.fromEntries(
        transcriptSpeakerIds(result.segments).map((id, index) => [id, `Спикер ${index + 1}`]),
      );
      setSpeakerNames(names);
      setTranscript(visitTranscriptText(result.segments, names));
      setEdited(false);
      setPhase({ kind: 'review', recording, result });
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось распознать запись.'));
      // The recording stays on the device, so the doctor can retry without re-recording.
      setPhase({
        kind: 'review',
        recording,
        result: { language: 'ru', durationMs: 0, segments: [] },
      });
    } finally {
      await listener.remove();
    }
  };

  const stop = async (): Promise<void> => {
    window.clearInterval(timer);
    setError('');
    try {
      await transcribe(await stopNativeRecording());
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось остановить запись.'));
      setPhase({ kind: 'ready' });
    }
  };

  const rename = (speakerId: string, name: string): void => {
    const current = phase();
    const names = { ...speakerNames(), [speakerId]: name };
    setSpeakerNames(names);
    if (current.kind === 'review' && !edited()) {
      setTranscript(visitTranscriptText(current.result.segments, names));
    }
  };

  const discard = async (recording: NativeRecordingResult): Promise<void> => {
    try {
      await deleteNativeRecording(recording.filePath);
      setPhase({ kind: 'ready' });
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось удалить запись.'));
    }
  };

  const save = async (recording: NativeRecordingResult): Promise<void> => {
    setError('');
    const review = phase();
    const id = eventId();
    try {
      const event = createVisitTranscriptEvent({
        id,
        patientId: props.patientId,
        episodeId: props.episodeId,
        occurredAt: new Date().toISOString(),
        durationMs: recording.durationMs,
        transcript: transcript(),
      });
      setPhase({ kind: 'saving' });
      // Audio first: an event must never reference a recording that failed to persist.
      await addPatientBlob({
        id: visitRecordingBlobId(id),
        patientId: props.patientId,
        mimeType: recording.mimeType,
        bytes: await readNativeRecording(recording.filePath),
      });
      const snapshot = await updatePatientVault((current) => appendEvent(current, event));
      await deleteNativeRecording(recording.filePath);
      toast.success('Расшифровка и аудиозапись сохранены в осмотр.');
      props.onSaved(snapshot);
      setConsent(false);
      setPhase({ kind: 'ready' });
    } catch (cause) {
      setError(errorMessage(cause, 'Не удалось сохранить беседу.'));
      // Keep the reviewed transcript and speaker names; the source file is still on the device.
      setPhase(review);
    }
  };

  return (
    <section class="visit-recorder paper-card">
      <Heading depth={3}>Запись беседы</Heading>
      <p class="visit-recorder__hint">
        Запись и распознавание выполняются на телефоне, без интернета. Говорящие разделяются
        автоматически; проверьте расшифровку перед сохранением.
      </p>
      <Show when={error()}>
        <p class="visit-recorder__error" role="alert">
          {error()}
        </p>
      </Show>
      {(() => {
        const current = phase();
        switch (current.kind) {
          case 'checking':
            return <p class="visit-recorder__hint">Проверяем модели распознавания…</p>;
          case 'models-missing':
            return (
              <div class="visit-recorder__actions">
                <Button variant="primary" onClick={() => void downloadModels()}>
                  Загрузить модели
                  {current.bytesTotal > 0 ? ` (${megabytes(current.bytesTotal)})` : ''}
                </Button>
              </div>
            );
          case 'downloading':
            return (
              <div class="visit-recorder__progress">
                <DownloadProgress
                  value={(current.bytesReady / current.bytesTotal) * 100}
                  label="Загрузка моделей распознавания"
                />
                <span class="visit-recorder__hint">
                  {megabytes(current.bytesReady)} из {megabytes(current.bytesTotal)}
                </span>
              </div>
            );
          case 'ready':
            return (
              <div class="visit-recorder__start">
                <Checkbox
                  label="Пациент согласен на аудиозапись беседы"
                  checked={consent()}
                  onChange={(event) => setConsent(event.currentTarget.checked)}
                />
                <div class="visit-recorder__actions">
                  <Button variant="primary" disabled={!consent()} onClick={() => void start()}>
                    Начать запись
                  </Button>
                </div>
              </div>
            );
          case 'recording':
            return (
              <div class="visit-recorder__recording">
                <span class="visit-recorder__timer" role="timer" aria-live="off">
                  <span class="visit-recorder__dot" aria-hidden="true" />
                  {formatRecordingDuration(elapsedMs())}
                </span>
                <Button variant="danger" onClick={() => void stop()}>
                  Остановить и расшифровать
                </Button>
              </div>
            );
          case 'transcribing':
            return (
              <div class="visit-recorder__progress">
                <DownloadProgress
                  value={
                    current.progress
                      ? (current.progress.completed / current.progress.total) * 100
                      : undefined
                  }
                  label="Распознавание записи"
                />
                <span class="visit-recorder__hint" aria-live="polite">
                  {current.progress
                    ? STAGE_LABEL[current.progress.stage]
                    : 'Запускаем распознавание'}
                  … Длинная запись обрабатывается несколько минут.
                </span>
              </div>
            );
          case 'review':
            return (
              <div class="visit-recorder__review">
                <Show
                  when={current.result.segments.length > 0}
                  fallback={
                    <div class="visit-recorder__actions">
                      <Button variant="primary" onClick={() => void transcribe(current.recording)}>
                        Распознать заново
                      </Button>
                      <Button variant="danger" onClick={() => void discard(current.recording)}>
                        Удалить запись
                      </Button>
                    </div>
                  }
                >
                  <div class="visit-recorder__speakers">
                    <For each={transcriptSpeakerIds(current.result.segments)}>
                      {(speakerId, index) => (
                        <TextField
                          label={`Говорящий ${index() + 1}`}
                          value={speakerNames()[speakerId] ?? ''}
                          placeholder="Например: Врач или Пациент"
                          onInput={(event) => rename(speakerId, event.currentTarget.value)}
                        />
                      )}
                    </For>
                  </div>
                  <TextArea
                    label="Расшифровка"
                    textareaClass="visit-recorder__transcript"
                    value={transcript()}
                    onInput={(event) => {
                      setEdited(true);
                      setTranscript(event.currentTarget.value);
                    }}
                  />
                  <div class="visit-recorder__actions">
                    <Button variant="primary" onClick={() => void save(current.recording)}>
                      Сохранить в осмотр
                    </Button>
                    <Button variant="danger" onClick={() => void discard(current.recording)}>
                      Удалить запись
                    </Button>
                  </div>
                </Show>
              </div>
            );
          case 'saving':
            return <p class="visit-recorder__hint">Сохраняем в карту пациента…</p>;
        }
      })()}
    </section>
  );
}

export function VisitRecorder(props: {
  readonly patientId: string;
  readonly episodeId: string | undefined;
  readonly onSaved: (snapshot: PatientVaultSnapshot) => void;
}): JSX.Element {
  return (
    <Show when={isNativeTranscriberAvailable() && props.episodeId}>
      {(episodeId) => (
        <VisitRecorderPanel
          patientId={props.patientId}
          episodeId={episodeId()}
          onSaved={props.onSaved}
        />
      )}
    </Show>
  );
}
