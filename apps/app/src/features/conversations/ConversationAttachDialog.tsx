import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { notifyWithOpen } from '@/components/notify';
import { OverlayDialog } from '@/components/OverlayDialog';
import { PatientPickerRow } from '@/components/PatientPickerRow';
import { SelectField } from '@/components/SelectField';
import {
  attachConversation,
  conversationSession,
  conversationTitle,
  loadConversationLines,
} from '@/features/conversations/conversation-session';
import { openEncryptedVault } from '@/features/conversations/conversation-transcript';
import { PulseDots } from '@/features/conversations/PulseDots';
import { resolveRecordedDuration } from '@/features/conversations/recorded-duration';
import { notesPatientsPath } from '@/features/notes/notes-routing';
import { type ConversationRecording, readConversationAudio } from '@/state/conversation-recordings';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import {
  isPatientVaultUnlocked,
  PATIENT_VAULT_EVENT,
  readPatientVault,
} from '@/state/patient-vault';

import './conversation-recorder.css';

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
  const [storedLines, setStoredLines] = createSignal<readonly string[]>([]);
  /** The text still in memory from this session, else what the vault holds for the recording. */
  const held = conversationSession.transcript(props.recording.id);
  const lines = (): readonly string[] => held?.lines() ?? storedLines();

  const loadVault = (): void => {
    if (!isPatientVaultUnlocked()) {
      setVault(null);
      return;
    }
    void readPatientVault()
      .then(setVault)
      .catch(() => setVault(null));
  };
  const loadText = (): void => {
    if (held) return;
    void loadConversationLines(props.recording)
      .then((stored) => setStoredLines(stored.lines))
      .catch(() => setError('Не удалось открыть текст беседы.'));
  };
  const sync = (): void => {
    loadVault();
    loadText();
  };

  onMount(() => {
    void readConversationAudio(props.recording.id)
      .then((blob) => setAudioUrl(URL.createObjectURL(blob)))
      .catch(() => setError('Не удалось открыть аудио.'));
    // On a phone the encrypted vault opens with its device key; nothing is asked of the doctor.
    void openEncryptedVault()
      .catch(() => setError('Не удалось открыть защищённое хранилище.'))
      .finally(sync);
    window.addEventListener(PATIENT_VAULT_EVENT, sync);
    onCleanup(() => window.removeEventListener(PATIENT_VAULT_EVENT, sync));
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
          <audio
            class="conversation-dialog__audio"
            src={url()}
            controls
            preload="metadata"
            onLoadedMetadata={(event) => resolveRecordedDuration(event.currentTarget)}
          />
        )}
      </Show>
      <Show when={lines().length > 0 || held?.settling()}>
        <section class="conversation-dialog__transcript" aria-label="Текст беседы">
          <For each={lines()}>{(line) => <p class="conversation-dialog__line">{line}</p>}</For>
          <Show when={held?.settling()}>
            <PulseDots label="Дочитываем запись" working />
          </Show>
        </section>
      </Show>
      <div class="conversation-dialog__attach">
        <PatientPickerRow
          profiles={vault()?.profiles ?? []}
          patientId={patientId()}
          unlocked={vault() !== null}
          allowNone={false}
          hint="Кому добавить запись"
          onPatientChange={setPatientId}
          onSnapshotChange={setVault}
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
      </div>
      <Show when={error()}>
        <p class="conversation-dialog__error" role="alert">
          {error()}
        </p>
      </Show>
      <div class="conversation-dialog__actions">
        <Button variant="quiet" onClick={props.onClose}>
          Позже
        </Button>
        <Button variant="primary" disabled={!patientId() || saving()} onClick={() => void attach()}>
          {saving() ? 'Добавляем…' : 'Добавить в карту'}
        </Button>
      </div>
    </OverlayDialog>
  );
}
