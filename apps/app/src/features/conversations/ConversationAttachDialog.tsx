import {
  createEffect,
  createResource,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { AudioPlayer } from '@/components/AudioPlayer';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { notifyWithOpen } from '@/components/notify';
import { OverlayDialog } from '@/components/OverlayDialog';
import { PatientPickerRow } from '@/components/PatientPickerRow';
import { SelectField } from '@/components/SelectField';
import { AsrModelCard } from '@/features/asr/AsrModelCard';
import { asrInstall, watchAsrInstall } from '@/features/asr/asr-model-install';
import {
  attachConversation,
  conversationSession,
  conversationTitle,
  ensureRecordingPeaks,
  loadConversationSegments,
  recordingNeedsTranscript,
  removeConversation,
  transcribeRecording,
} from '@/features/conversations/conversation-session';
import type { TranscriptSegment } from '@/features/conversations/live-transcription';
import { PulseDots } from '@/features/conversations/PulseDots';
import { patientName, usePatientSnapshot } from '@/features/conversations/use-patient-snapshot';
import {
  CONVERSATION_FORMS,
  type ConversationFormEntry,
} from '@/features/form-fill/conversation-forms';
import { handOffConversation } from '@/features/form-fill/form-fill-handoff';
import { notesPatientsPath } from '@/features/notes/notes-routing';
import { pushRoute } from '@/state/app-back';
import { type ConversationRecording, readConversationAudio } from '@/state/conversation-recordings';
import { afterLayersClosed } from '@/state/history-layer';

import './conversation-recorder.css';

function sheetTitle(recording: ConversationRecording, from: 'stopped' | 'list'): string {
  if (recording.status === 'interrupted') return 'Запись прервалась';
  return from === 'stopped' ? 'Запись сохранена' : 'Запись беседы';
}

/**
 * One recording (REC1): the app's player with the waveform and the text following it, «Расшифровать»
 * for what is not text yet, the patient it belongs to (added to their card here, or opened from it)
 * and the forms the conversation can fill. Opened after «Стоп», from «Файлы» and from a patient.
 */
export function ConversationRecordingSheet(props: {
  readonly recording: ConversationRecording;
  readonly onClose: () => void;
}): JSX.Element {
  const [audioUrl, setAudioUrl] = createSignal('');
  const [patientId, setPatientId] = createSignal(props.recording.patientId ?? '');
  const [episodeId, setEpisodeId] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [stored, setStored] = createSignal<readonly TranscriptSegment[]>([]);
  const [pickingForm, setPickingForm] = createSignal(false);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [needsText, setNeedsText] = createSignal(false);
  const patients = usePatientSnapshot(setError);
  const held = () => conversationSession.transcript(props.recording.id);
  const segments = (): readonly TranscriptSegment[] => held()?.segments() ?? stored();
  const lines = (): readonly string[] => segments().map((segment) => segment.text);
  const settling = (): boolean => held()?.settling() ?? false;
  const progress = (): number | null => held()?.progress() ?? null;
  const [peaks] = createResource(
    () => props.recording,
    (recording) => ensureRecordingPeaks(recording).catch(() => [] as readonly number[]),
  );

  const loadText = (): void => {
    void loadConversationSegments(props.recording)
      .then((found) => setStored(found.segments))
      .catch(() => setError('Не удалось открыть текст беседы.'));
    void recordingNeedsTranscript(props.recording)
      .then(setNeedsText)
      .catch(() => setNeedsText(false));
  };

  onMount(() => {
    onCleanup(watchAsrInstall());
    void readConversationAudio(props.recording.id)
      .then((blob) => setAudioUrl(URL.createObjectURL(blob)))
      .catch(() => setError('Не удалось открыть аудио.'));
    loadText();
  });
  onCleanup(() => {
    const url = audioUrl();
    if (url) URL.revokeObjectURL(url);
  });
  // A run that ends (live tail read, «Расшифровать» done) changes what is left to read.
  createEffect(() => {
    if (!settling()) loadText();
  });

  const episodes = () =>
    patients
      .snapshot()
      ?.episodes.filter(
        (episode) => episode.patientId === patientId() && episode.status === 'open',
      ) ?? [];
  createEffect(() => {
    patientId();
    setEpisodeId(episodes()[0]?.id ?? '');
  });

  /** Opens the picked form; a handed-over transcript opens its «Беседа» sheet on the values. */
  const openForm = (form: ConversationFormEntry): void => {
    // Read everything before closing: the sheet's props go stale once it unmounts.
    const route = form.route(props.recording.id);
    if (form.handOff) {
      handOffConversation({
        sourceId: form.id,
        label: conversationTitle(props.recording),
        lines: lines(),
      });
    }
    props.onClose();
    // The sheet's history entry goes first; the form then opens on the page's own entry.
    afterLayersClosed(() => pushRoute(route));
  };

  const openPatient = (id: string): void => {
    props.onClose();
    afterLayersClosed(() => pushRoute(notesPatientsPath(id)));
  };

  const attach = async (): Promise<void> => {
    if (!patientId() || saving()) return;
    setSaving(true);
    setError('');
    try {
      const patient = patientId();
      await attachConversation(props.recording, patient, episodeId() || undefined);
      await conversationSession.refreshFinished();
      notifyWithOpen('Запись добавлена в карту пациента.', () => openPatient(patient));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось добавить запись.');
    } finally {
      setSaving(false);
    }
  };

  const transcribe = async (): Promise<void> => {
    setError('');
    try {
      await transcribeRecording(props.recording);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось расшифровать запись.');
    }
  };

  const remove = async (): Promise<void> => {
    setConfirmDelete(false);
    try {
      await removeConversation(props.recording);
      props.onClose();
    } catch {
      setError('Не удалось полностью удалить запись беседы.');
    }
  };

  const attachedName = (): string =>
    props.recording.attachedTo
      ? patientName(patients.snapshot(), props.recording.attachedTo.patientId) || 'Пациент'
      : '';

  return (
    <OverlayDialog
      open
      title={sheetTitle(props.recording, conversationSession.finishedFrom())}
      subtitle={`${conversationTitle(props.recording)} · ${new Date(
        props.recording.startedAt,
      ).toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })}`}
      class="recording-sheet"
      bodyClass="recording-sheet__body"
      onClose={props.onClose}
    >
      <Show when={props.recording.status === 'interrupted'}>
        <p class="recording-sheet__note">
          Приложение закрылось во время записи. Всё, что успело записаться, сохранено.
        </p>
      </Show>
      <Show when={audioUrl()}>
        {(url) => (
          <AudioPlayer
            src={url()}
            label={conversationTitle(props.recording)}
            durationMs={props.recording.durationMs}
            peaks={peaks.latest ?? props.recording.peaks ?? []}
            segments={segments()}
          />
        )}
      </Show>

      <Show when={settling()}>
        <div class="recording-sheet__progress" data-testid="recording-transcribing">
          <div class="recording-sheet__progress-row">
            <PulseDots working label="Расшифровываем" />
            <Show when={progress() !== null}>
              <span>{Math.round((progress() ?? 0) * 100)} %</span>
            </Show>
          </div>
          <Show when={progress() !== null}>
            <div class="recording-sheet__bar" aria-hidden="true">
              <div
                class="recording-sheet__bar-fill"
                style={{ '--recording-progress': String(progress() ?? 0) }}
              />
            </div>
          </Show>
        </div>
      </Show>
      <Show when={!settling() && needsText()}>
        <div class="recording-sheet__transcribe">
          <Show when={asrInstall.phase() === 'ready'} fallback={<AsrModelCard compact />}>
            <Button
              variant="primary"
              icon={<AppGlyph name="waveform" />}
              onClick={() => void transcribe()}
            >
              {lines().length > 0 ? 'Расшифровать остальное' : 'Расшифровать'}
            </Button>
          </Show>
        </div>
      </Show>

      <Show when={lines().length > 0 && !settling()}>
        <Button
          variant="quiet"
          class="conversation-dialog__fill"
          icon={<AppGlyph name="note-pencil" />}
          aria-expanded={pickingForm()}
          onClick={() => setPickingForm((open) => !open)}
        >
          Заполнить форму
        </Button>
        <Show when={pickingForm()}>
          <ul class="conversation-dialog__forms" aria-label="Форма по беседе">
            <For each={CONVERSATION_FORMS}>
              {(form) => (
                <li class="conversation-dialog__form-item">
                  <button
                    type="button"
                    class="conversation-dialog__form"
                    onClick={() => openForm(form)}
                  >
                    <AppGlyph name={form.glyph} class="conversation-dialog__form-glyph" />
                    <span class="conversation-dialog__form-text">
                      <span class="conversation-dialog__form-title">{form.title}</span>
                      <span class="conversation-dialog__form-subtitle">{form.subtitle}</span>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>

      <div class="recording-sheet__patient">
        <Show
          when={props.recording.attachedTo}
          fallback={
            <>
              <PatientPickerRow
                profiles={patients.snapshot()?.profiles ?? []}
                patientId={patientId()}
                unlocked={patients.snapshot() !== null}
                allowNone={false}
                hint="Кому добавить запись"
                onPatientChange={setPatientId}
                onSnapshotChange={patients.setSnapshot}
              />
              <Show when={patientId() && episodes().length > 0}>
                <SelectField
                  label="Визит"
                  value={episodeId()}
                  options={[
                    ...episodes().map((episode) => ({ value: episode.id, label: episode.title })),
                    { value: '', label: 'Без визита' },
                  ]}
                  onChange={(event) => setEpisodeId(event.currentTarget.value)}
                />
              </Show>
            </>
          }
        >
          {(attached) => (
            <div class="recording-sheet__filed">
              <AppGlyph name="users" class="recording-sheet__filed-icon" />
              <span class="recording-sheet__filed-text">
                <span class="recording-sheet__filed-label">В карте пациента</span>
                <span class="recording-sheet__filed-name">{attachedName()}</span>
              </span>
              <Button variant="quiet" onClick={() => openPatient(attached().patientId)}>
                Открыть
              </Button>
            </div>
          )}
        </Show>
      </div>

      <Show when={error()}>
        <p class="recording-sheet__error" role="alert">
          {error()}
        </p>
      </Show>
      <div class="recording-sheet__actions">
        <Button
          variant="quiet"
          class="recording-sheet__delete"
          icon={<AppGlyph name="trash" />}
          aria-label="Удалить запись"
          title="Удалить запись"
          onClick={() => setConfirmDelete(true)}
        />
        <Show
          when={!props.recording.attachedTo}
          fallback={
            <Button variant="primary" onClick={props.onClose}>
              Готово
            </Button>
          }
        >
          <Button variant="quiet" onClick={props.onClose}>
            Позже
          </Button>
          <Button
            variant="primary"
            disabled={!patientId() || saving()}
            onClick={() => void attach()}
          >
            {saving() ? 'Добавляем…' : 'Добавить в карту'}
          </Button>
        </Show>
      </div>
      <ConfirmationDialog
        open={confirmDelete()}
        title="Удалить запись беседы?"
        description={
          props.recording.attachedTo
            ? 'Копия в карте пациента останется. Удалится только запись на этом устройстве.'
            : 'Запись ещё не добавлена к пациенту и будет удалена безвозвратно.'
        }
        confirmLabel="Удалить"
        danger
        onConfirm={() => void remove()}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(false);
        }}
      />
    </OverlayDialog>
  );
}
