import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { notifyWithOpen } from '@/components/notify';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SelectField } from '@/components/SelectField';
import { AsrModelCard } from '@/features/asr/AsrModelCard';
import { asrInstall } from '@/features/asr/asr-model-install';
import { formatRecordingDuration } from '@/features/asr/visit-recording';
import {
  attachConversation,
  conversationSession,
  conversationTitle,
  loadConversationLines,
  recoverConversations,
  stopConversation,
} from '@/features/conversations/conversation-session';
import {
  openEncryptedVault,
  type TranscriptSaveState,
} from '@/features/conversations/conversation-transcript';
import { toastMicrophoneError } from '@/features/conversations/microphone-toast';
import { notesPatientsPath } from '@/features/notes/notes-routing';
import { type ConversationRecording, readConversationAudio } from '@/state/conversation-recordings';
import type { PatientVaultSnapshot } from '@/state/patient-domain';
import {
  isPatientVaultUnlocked,
  PATIENT_VAULT_EVENT,
  readPatientVault,
} from '@/state/patient-vault';

import './conversation-recorder.css';

/** The level meter, shared by the bar and the live window. */
function LevelMeter(props: { readonly class: string; readonly barClass: string }): JSX.Element {
  const bars = Array.from({ length: 12 }, (_, index) => index);
  return (
    <span class={props.class} aria-hidden="true">
      <For each={bars}>
        {(index) => (
          <span
            class={props.barClass}
            style={{
              '--conversation-level': String(
                Math.max(0.15, conversationSession.level() * (0.6 + ((index * 7) % 5) / 10)),
              ),
            }}
          />
        )}
      </For>
    </span>
  );
}

/**
 * Floating bar over every screen while a conversation is being recorded: the app-level activity
 * indicator. Tapping it expands the live window; «Стоп» ends the recording.
 */
function RecordingBar(): JSX.Element {
  return (
    <Show when={conversationSession.recorder() && !conversationSession.windowOpen()}>
      <Portal>
        <div class="conversation-bar" role="status" aria-live="polite">
          <button
            type="button"
            class="conversation-bar__expand"
            aria-label="Идёт запись беседы. Открыть окно с текстом"
            title="Открыть окно с текстом"
            onClick={() => conversationSession.openWindow()}
          >
            <span class="conversation-bar__dot" aria-hidden="true" />
            <span class="conversation-bar__label">Идёт запись беседы</span>
            <span class="conversation-bar__time">
              {formatRecordingDuration(conversationSession.elapsedMs())}
            </span>
            <LevelMeter class="conversation-bar__meter" barClass="conversation-bar__meter-bar" />
          </button>
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

const SAVE_LABEL: Readonly<Record<Exclude<TranscriptSaveState, 'idle'>, string>> = {
  pending: 'Сохраняем текст',
  saved: 'Текст зашифрован и сохранён на устройстве',
  unsaved: 'Текст не сохраняется: нет защищённого хранилища',
  failed: 'Не удалось сохранить текст',
};

/** A lock that says, without words on screen, whether the text is safely on the device. */
function SaveMark(props: { readonly state: TranscriptSaveState }): JSX.Element {
  return (
    <Show when={props.state !== 'idle' && props.state}>
      {(state) => (
        <span
          class="conversation-save"
          classList={{
            'conversation-save--saved': state() === 'saved',
            'conversation-save--warning': state() === 'unsaved',
            'conversation-save--failed': state() === 'failed',
          }}
          role="img"
          aria-label={SAVE_LABEL[state()]}
          title={SAVE_LABEL[state()]}
        >
          <AppGlyph name="lock" class="conversation-save__icon" />
        </span>
      )}
    </Show>
  );
}

/** Three quiet dots: the model is listening (steady) or reading a stretch (brighter). */
function PulseDots(props: { readonly working?: boolean; readonly label: string }): JSX.Element {
  return (
    <span
      class="conversation-pulse"
      classList={{ 'conversation-pulse--working': props.working === true }}
      role="status"
      aria-label={props.label}
    >
      <span class="conversation-pulse__dot" />
      <span class="conversation-pulse__dot" />
      <span class="conversation-pulse__dot" />
    </span>
  );
}

/**
 * The expanded activity: the shared floating-window frame (toolbar, full-screen toggle) around the
 * timer, the level meter, the live text as it appears and the stop control. Without a speech model
 * the text area is the install card; once the model is ready the text takes its place.
 */
function RecordingWindow(): JSX.Element {
  let text: HTMLDivElement | undefined;
  const fullscreen = () => conversationSession.windowFullscreen();
  const lines = () => conversationSession.liveLines();
  const phase = asrInstall.phase;
  const showCard = (): boolean =>
    lines().length === 0 && ['missing', 'cached', 'loading', 'failed'].includes(phase());
  const showText = (): boolean => !showCard() && (lines().length > 0 || phase() === 'ready');
  createEffect(() => {
    lines();
    requestAnimationFrame(() => text?.scrollTo({ top: text.scrollHeight }));
  });
  onMount(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (fullscreen()) conversationSession.toggleFullscreen();
      else conversationSession.closeWindow();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });
  return (
    <Portal>
      <section
        class="floating-windows-layer"
        classList={{ 'floating-windows-layer--fullscreen': fullscreen() }}
        aria-label="Запись беседы"
      >
        <section
          class="floating-window floating-window--active conversation-live"
          classList={{
            'floating-window--fullscreen': fullscreen(),
            'conversation-live--fullscreen': fullscreen(),
          }}
          role="dialog"
          aria-label="Идёт запись беседы"
          data-testid="conversation-live"
        >
          <header
            class="floating-window__toolbar"
            classList={{ 'floating-window__toolbar--fullscreen': fullscreen() }}
          >
            <button
              class="floating-window__button"
              type="button"
              aria-label="Свернуть в строку записи"
              title="Свернуть в строку записи"
              onClick={() => conversationSession.closeWindow()}
            >
              <AppGlyph name="caret-down" class="floating-window__icon" />
            </button>
            <strong class="floating-window__title">Идёт запись беседы</strong>
            <div class="floating-window__actions">
              <button
                class="floating-window__button floating-window__button--fullscreen"
                type="button"
                aria-label={fullscreen() ? 'Свернуть в маленькое окно' : 'Открыть на весь экран'}
                title={fullscreen() ? 'Свернуть в маленькое окно' : 'На весь экран'}
                onClick={() => conversationSession.toggleFullscreen()}
              >
                <AppGlyph
                  name={fullscreen() ? 'arrows-in' : 'arrows-out'}
                  class="floating-window__icon"
                />
              </button>
            </div>
          </header>
          <div
            class="floating-window__content conversation-live__body"
            classList={{ 'conversation-live__body--fullscreen': fullscreen() }}
          >
            <div class="conversation-live__status" role="timer" aria-live="off">
              <span class="conversation-live__dot" aria-hidden="true" />
              <span class="conversation-live__time">
                {formatRecordingDuration(conversationSession.elapsedMs())}
              </span>
              <LevelMeter
                class="conversation-live__meter"
                barClass="conversation-live__meter-bar"
              />
              <SaveMark state={conversationSession.saveState()} />
            </div>
            <div class="conversation-live__stage">
              <div
                class="conversation-live__layer conversation-live__layer--card"
                classList={{ 'conversation-live__layer--hidden': !showCard() }}
                inert={!showCard()}
              >
                <AsrModelCard compact={!fullscreen()} />
              </div>
              <div
                class="conversation-live__layer"
                classList={{ 'conversation-live__layer--hidden': !showText() }}
                inert={!showText()}
              >
                <div
                  class="conversation-live__text"
                  classList={{
                    'conversation-live__text--empty': lines().length === 0,
                    'conversation-live__text--plain': fullscreen(),
                  }}
                  ref={(element) => {
                    text = element;
                  }}
                >
                  <ol class="conversation-live__lines" aria-label="Текст беседы" aria-live="polite">
                    <For each={lines()}>
                      {(line) => <li class="conversation-live__line">{line}</li>}
                    </For>
                  </ol>
                  <Show
                    when={conversationSession.liveStatus() !== 'failed'}
                    fallback={
                      <p class="conversation-live__problem" role="alert">
                        <AppGlyph name="info" class="conversation-live__problem-icon" />
                        Распознавание остановилось
                      </p>
                    }
                  >
                    <PulseDots
                      working={conversationSession.liveStatus() === 'working'}
                      label={
                        conversationSession.liveStatus() === 'working'
                          ? 'Распознаём речь'
                          : 'Слушаем'
                      }
                    />
                  </Show>
                </div>
              </div>
            </div>
            <Button
              class="conversation-live__stop"
              variant="danger"
              icon={<AppGlyph name="stop-circle" class="conversation-bar__stop-icon" />}
              onClick={() => void stopConversation()}
            >
              Стоп
            </Button>
          </div>
        </section>
      </section>
    </Portal>
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
          <audio class="conversation-dialog__audio" src={url()} controls preload="metadata" />
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
    toastMicrophoneError(message, conversationSession.errorOpensSettings());
    conversationSession.clearError();
  });
  return (
    <>
      <RecordingBar />
      <Show when={conversationSession.recorder() && conversationSession.windowOpen()}>
        <RecordingWindow />
      </Show>
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
