import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { notifyWithOpen } from '@/components/notify';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SelectField } from '@/components/SelectField';
import { formatRecordingDuration } from '@/features/asr/visit-recording';
import {
  attachConversation,
  conversationSession,
  conversationTitle,
  recoverConversations,
  stopConversation,
} from '@/features/conversations/conversation-session';
import { notesPatientsPath } from '@/features/notes/notes-routing';
import { type ConversationRecording, readConversationAudio } from '@/state/conversation-recordings';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import {
  isPatientVaultUnlocked,
  PATIENT_VAULT_EVENT,
  readPatientVault,
} from '@/state/patient-vault';

import './conversation-recorder.css';

/** Floating bar over every screen while a conversation is being recorded. */
function RecordingBar(): JSX.Element {
  const bars = Array.from({ length: 12 }, (_, index) => index);
  return (
    <Show when={conversationSession.recorder()}>
      <Portal>
        <div class="conversation-bar" role="status" aria-live="polite">
          <span class="conversation-bar__dot" aria-hidden="true" />
          <span class="conversation-bar__label">Запись беседы</span>
          <span class="conversation-bar__time">
            {formatRecordingDuration(conversationSession.elapsedMs())}
          </span>
          <span class="conversation-bar__meter" aria-hidden="true">
            <For each={bars}>
              {(index) => (
                <span
                  class="conversation-bar__meter-bar"
                  style={{
                    '--conversation-level': String(
                      Math.max(0.15, conversationSession.level() * (0.6 + ((index * 7) % 5) / 10)),
                    ),
                  }}
                />
              )}
            </For>
          </span>
          <Button
            class="conversation-bar__stop"
            variant="danger"
            icon={<AppGlyph name="stop-circle" class="conversation-bar__stop-icon" />}
            onClick={() => void stopConversation()}
          >
            Стоп
          </Button>
        </div>
      </Portal>
    </Show>
  );
}

/** Where a finished (or recovered) recording goes: a patient's card or the inbox for later. */
export function ConversationAttachDialog(props: {
  readonly recording: ConversationRecording;
  readonly onClose: () => void;
}): JSX.Element {
  const [audioUrl, setAudioUrl] = createSignal('');
  const [vault, setVault] = createSignal<PatientVaultSnapshot | null>(null);
  const [patientId, setPatientId] = createSignal('');
  const [episodeId, setEpisodeId] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');

  const loadVault = (): void => {
    if (!isPatientVaultUnlocked()) {
      setVault(null);
      return;
    }
    void readPatientVault()
      .then(setVault)
      .catch(() => setVault(null));
  };

  onMount(() => {
    void readConversationAudio(props.recording.id)
      .then((blob) => setAudioUrl(URL.createObjectURL(blob)))
      .catch(() => setError('Не удалось открыть аудио.'));
    loadVault();
    window.addEventListener(PATIENT_VAULT_EVENT, loadVault);
    onCleanup(() => window.removeEventListener(PATIENT_VAULT_EVENT, loadVault));
  });
  onCleanup(() => {
    const url = audioUrl();
    if (url) URL.revokeObjectURL(url);
  });

  const episodes = () =>
    vault()?.episodes.filter(
      (episode) => episode.patientId === patientId() && episode.status === 'open',
    ) ?? [];
  createEffect(() => {
    patientId();
    setEpisodeId(episodes()[0]?.id ?? '');
  });

  const attach = async (): Promise<void> => {
    if (!patientId() || saving()) return;
    setSaving(true);
    setError('');
    try {
      const patient = patientId();
      await attachConversation(props.recording, patient, episodeId() || undefined);
      notifyWithOpen('Запись добавлена в карту пациента.', () => {
        window.location.hash = notesPatientsPath(patient);
      });
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось добавить запись.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <OverlayDialog
      open
      title={props.recording.status === 'interrupted' ? 'Запись прервалась' : 'Запись сохранена'}
      subtitle={`${conversationTitle(props.recording)} · на этом устройстве`}
      class="conversation-dialog"
      bodyClass="conversation-dialog__body"
      onClose={props.onClose}
    >
      <Show when={props.recording.status === 'interrupted'}>
        <p class="conversation-dialog__text">
          Приложение закрылось во время записи. Всё, что успело записаться, сохранено.
        </p>
      </Show>
      <Show when={audioUrl()}>
        {(url) => (
          // biome-ignore lint/a11y/useMediaCaption: a doctor's own conversation recording has no captions.
          <audio class="conversation-dialog__audio" src={url()} controls preload="metadata" />
        )}
      </Show>
      <Show
        when={vault()}
        fallback={
          <div class="conversation-dialog__locked">
            <p class="conversation-dialog__text">
              Чтобы добавить запись к пациенту, откройте раздел «Пациенты». Запись подождёт в
              «Записях бесед».
            </p>
            <Button
              onClick={() => {
                props.onClose();
                window.location.hash = '#/notes/patients';
              }}
            >
              Открыть пациентов
            </Button>
          </div>
        }
      >
        {(snapshot) => (
          <div class="conversation-dialog__attach">
            <SelectField
              label="Пациент"
              value={patientId()}
              options={[
                { value: '', label: 'Выберите пациента' },
                ...snapshot().profiles.map((profile) => ({
                  value: profile.id,
                  label: profile.displayName,
                })),
              ]}
              onChange={(event) => setPatientId(event.currentTarget.value)}
            />
            <Show when={patientId()}>
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
          </div>
        )}
      </Show>
      <Show when={error()}>
        <p class="conversation-dialog__error" role="alert">
          {error()}
        </p>
      </Show>
      <div class="conversation-dialog__actions">
        <Button variant="quiet" onClick={props.onClose}>
          Позже
        </Button>
        <Show when={vault()}>
          <Button
            variant="primary"
            disabled={!patientId() || saving()}
            onClick={() => void attach()}
          >
            {saving() ? 'Добавляем…' : 'Добавить в карту'}
          </Button>
        </Show>
      </div>
    </OverlayDialog>
  );
}

/** App-wide host: the recording bar, the post-recording dialog and crash recovery. */
export function ConversationRecorderHost(): JSX.Element {
  onMount(recoverConversations);
  createEffect(() => {
    const message = conversationSession.error();
    if (!message) return;
    toast.error(message);
    conversationSession.clearError();
  });
  return (
    <>
      <RecordingBar />
      <Show when={conversationSession.finished()}>
        {(recording) => (
          <ConversationAttachDialog
            recording={recording()}
            onClose={() => conversationSession.dismissFinished()}
          />
        )}
      </Show>
    </>
  );
}
