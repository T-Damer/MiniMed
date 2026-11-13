import {
  createEffect,
  createResource,
  createSignal,
  For,
  type JSX,
  lazy,
  Match,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { Portal } from 'solid-js/web';

import { AppGlyph } from '@/components/AppGlyph';
import { AsciiSpinner } from '@/components/AsciiSpinner';
import { OverlayDialog } from '@/components/OverlayDialog';
import { PatientPickerRow } from '@/components/PatientPickerRow';
import { AsrModelCard } from '@/features/asr/AsrModelCard';
import { asrInstall, watchAsrInstall } from '@/features/asr/asr-model-install';
import { formatRecordingDuration } from '@/features/asr/visit-recording';
import {
  conversationSession,
  recoverConversations,
  startConversation,
  stopConversation,
} from '@/features/conversations/conversation-session';
import {
  type TranscriptSaveState,
  type VaultOffer,
  vaultOffer,
} from '@/features/conversations/conversation-transcript';
import { LiveWaveform } from '@/features/conversations/LiveWaveform';
import { toastMicrophoneError } from '@/features/conversations/microphone-toast';
import { PulseDots } from '@/features/conversations/PulseDots';
import { usePatientSnapshot } from '@/features/conversations/use-patient-snapshot';

/** The recording sheet (player, text, patient) is needed only after a recording: loaded on demand. */
const ConversationRecordingSheet = lazy(() =>
  import('@/features/conversations/ConversationAttachDialog').then((module) => ({
    default: module.ConversationRecordingSheet,
  })),
);

import './conversation-recorder.css';

/**
 * The recording while the doctor uses the app (REC1, owner 2026-11-13): a floating button in the
 * app's floating-tools column, with the voice drawn live and the time. A tap opens the window.
 */
function RecorderFab(): JSX.Element {
  const host = (): HTMLElement | undefined =>
    document.getElementById('app-floating-controls') ?? undefined;
  const time = (): string => formatRecordingDuration(conversationSession.elapsedMs());
  return (
    <Show when={conversationSession.recorder() && !conversationSession.windowOpen()}>
      <Portal mount={host() ?? document.body}>
        <button
          type="button"
          class="recorder-fab floating-window-controls__item"
          classList={{
            'recorder-fab--paused': conversationSession.paused(),
            'recorder-fab--free': !host(),
          }}
          aria-label={`${conversationSession.paused() ? 'Запись на паузе' : 'Идёт запись беседы'}, ${time()}. Открыть запись`}
          title="Открыть запись"
          data-testid="recorder-fab"
          onClick={() => conversationSession.openWindow()}
        >
          <span
            class="recorder-fab__dot"
            classList={{ 'recorder-fab__dot--paused': conversationSession.paused() }}
            aria-hidden="true"
          >
            <Show when={conversationSession.paused()}>
              <AppGlyph name="pause-fill" class="recorder-fab__pause" />
            </Show>
          </span>
          <LiveWaveform
            class="recorder-fab__wave"
            source={() => conversationSession.recorder()}
            bar={2}
            gap={2}
          />
          <span class="recorder-fab__time">{time()}</span>
        </button>
      </Portal>
    </Show>
  );
}

const SAVE_LABEL: Readonly<Record<Exclude<TranscriptSaveState, 'idle' | 'unsaved'>, string>> = {
  pending: 'Сохраняем текст',
  saved: 'Текст зашифрован и сохранён на устройстве',
  failed: 'Не удалось сохранить текст',
};

/**
 * A lock that says, without words on screen, whether the text is safely on the device. An
 * unsaved text has the suggestion under the timer instead, which says the same in words.
 */
function SaveMark(props: { readonly state: TranscriptSaveState }): JSX.Element {
  return (
    <Show when={props.state !== 'idle' && props.state !== 'unsaved' && props.state}>
      {(state) => (
        <span
          class="conversation-save"
          classList={{
            'conversation-save--saved': state() === 'saved',
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

const OFFER_ACTION: Readonly<Record<VaultOffer, string>> = {
  create: 'Создать хранилище',
  encrypt: 'Зашифровать хранилище',
};

const OFFER_HINT: Readonly<Record<VaultOffer, string>> = {
  create:
    'Беседа останется только на экране. Хранилище шифрует текст ключом этого устройства и сохраняет его сразу.',
  encrypt:
    'Карточки пациентов лежат без шифрования. Мы зашифруем их ключом этого устройства и сохраним текст.',
};

/**
 * Shown while the text has no encrypted vault to go to: one tap creates the vault (or encrypts the
 * plaintext one) and the text so far is written at once. The recording is never interrupted; the
 * row folds away when the text is saved, leaving only the lock beside the timer.
 */
function VaultSuggestion(props: { readonly state: TranscriptSaveState }): JSX.Element {
  const open = (): boolean => props.state === 'unsaved';
  const [offer] = createResource(open, (shown) => (shown ? vaultOffer() : undefined));
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal('');
  const kind = (): VaultOffer => offer.latest ?? 'create';
  const enable = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    setFailure('');
    try {
      await conversationSession.enableTranscriptStorage();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Не удалось создать хранилище.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      class="conversation-offer"
      classList={{ 'conversation-offer--open': open() }}
      inert={!open()}
    >
      <div class="conversation-offer__clip">
        <button
          type="button"
          class="conversation-offer__chip"
          classList={{ 'conversation-offer__chip--failed': failure() !== '' }}
          disabled={busy()}
          aria-label={`Текст не сохранится. ${OFFER_ACTION[kind()]}`}
          title={OFFER_HINT[kind()]}
          onClick={() => void enable()}
        >
          <span class="conversation-offer__badge" aria-hidden="true">
            <AppGlyph name="lock" class="conversation-offer__icon" />
          </span>
          <span class="conversation-offer__text">
            <span class="conversation-offer__title">
              {failure() || 'Текст не сохранится'}
              <Show when={!failure()}>
                {' · '}
                <span class="conversation-offer__action">
                  <Show when={busy()} fallback={OFFER_ACTION[kind()]}>
                    <AsciiSpinner class="conversation-offer__spinner" /> Готовим…
                  </Show>
                </span>
              </Show>
            </span>
          </span>
          <Show when={failure()}>
            <span class="conversation-offer__action conversation-offer__action--retry">
              Повторить
            </span>
          </Show>
        </button>
      </div>
    </div>
  );
}

/**
 * Where the text stands while recording: the install card without a model, the lines as they come,
 * or one quiet line when the phone is too busy for live text (it is read after «Стоп»).
 */
function LiveText(): JSX.Element {
  let text: HTMLDivElement | undefined;
  const lines = () => conversationSession.liveLines();
  const status = () => conversationSession.liveStatus();
  const phase = asrInstall.phase;
  const showCard = (): boolean =>
    lines().length === 0 && ['missing', 'cached', 'loading', 'failed'].includes(phase());
  onMount(() => onCleanup(watchAsrInstall()));
  createEffect(() => {
    lines();
    requestAnimationFrame(() => text?.scrollTo({ top: text.scrollHeight, behavior: 'smooth' }));
  });
  return (
    <div class="recorder-window__text-stage">
      <Show
        when={!showCard()}
        fallback={
          <div class="recorder-window__card">
            <AsrModelCard compact />
          </div>
        }
      >
        <div
          class="recorder-window__text"
          classList={{ 'recorder-window__text--empty': lines().length === 0 }}
          ref={(element) => {
            text = element;
          }}
        >
          <ol class="recorder-window__lines" aria-label="Текст беседы" aria-live="polite">
            <For each={lines()}>{(line) => <li class="recorder-window__line">{line}</li>}</For>
          </ol>
          <Switch
            fallback={
              <PulseDots
                working={status() === 'working'}
                label={status() === 'working' ? 'Распознаём речь' : 'Слушаем'}
              />
            }
          >
            <Match when={status() === 'deferred'}>
              <p class="recorder-window__note" data-testid="recorder-deferred">
                <AppGlyph name="clock" class="recorder-window__note-icon" />
                Телефон занят — текст будет после записи
              </p>
            </Match>
            <Match when={status() === 'failed'}>
              <p class="recorder-window__note" role="alert">
                <AppGlyph name="info" class="recorder-window__note-icon" />
                Распознавание остановилось
              </p>
            </Match>
          </Switch>
        </div>
      </Show>
    </div>
  );
}

/**
 * The recorder's window (owner 2026-11-13): before a recording, the big record button; while
 * recording, the time, the voice, pause and stop, the patient the recording goes to and the live
 * text. Closing it («Свернуть») leaves the recording running behind the floating button.
 */
function RecorderWindow(): JSX.Element {
  const recording = (): boolean => conversationSession.recorder() !== null;
  const [failure, setFailure] = createSignal('');
  const patients = usePatientSnapshot(setFailure);
  return (
    <OverlayDialog
      open
      title={recording() ? 'Запись беседы' : 'Новая запись беседы'}
      class="recorder-window"
      bodyClass="recorder-window__body"
      closeControl={recording() ? { label: 'Свернуть', glyph: 'caret-down' } : undefined}
      onClose={() => conversationSession.closeWindow()}
    >
      <div class="recorder-window__content" data-testid="conversation-live">
        <Show
          when={recording()}
          fallback={
            <div class="recorder-window__ready">
              <button
                type="button"
                class="recorder-window__record"
                aria-label="Начать запись"
                title="Начать запись"
                disabled={conversationSession.starting()}
                onClick={() => void startConversation()}
              >
                <Show
                  when={!conversationSession.starting()}
                  fallback={<AsciiSpinner class="recorder-window__record-spinner" />}
                >
                  <AppGlyph name="microphone" class="recorder-window__record-icon" />
                </Show>
              </button>
            </div>
          }
        >
          <div class="recorder-window__status" role="timer" aria-live="off">
            <span
              class="recorder-window__state"
              classList={{ 'recorder-window__state--paused': conversationSession.paused() }}
            >
              {conversationSession.paused() ? 'Пауза' : 'Запись'}
            </span>
            <span class="recorder-window__time conversation-live__time">
              {formatRecordingDuration(conversationSession.elapsedMs())}
            </span>
            <SaveMark state={conversationSession.saveState()} />
          </div>
          <LiveWaveform
            class="recorder-window__wave"
            source={() => conversationSession.recorder()}
            bar={3}
            gap={2}
          />
          <div class="recorder-window__controls">
            <button
              type="button"
              class="recorder-window__control"
              aria-label={conversationSession.paused() ? 'Продолжить запись' : 'Пауза'}
              title={conversationSession.paused() ? 'Продолжить' : 'Пауза'}
              onClick={() =>
                conversationSession.paused()
                  ? conversationSession.resume()
                  : conversationSession.pause()
              }
            >
              <AppGlyph
                name={conversationSession.paused() ? 'microphone' : 'pause-fill'}
                class="recorder-window__control-icon"
              />
            </button>
            <button
              type="button"
              class="recorder-window__stop"
              aria-label="Стоп"
              title="Остановить и сохранить"
              onClick={() => void stopConversation()}
            >
              <span class="recorder-window__stop-square" aria-hidden="true" />
            </button>
          </div>
          <VaultSuggestion state={conversationSession.saveState()} />
        </Show>
        <PatientPickerRow
          class="recorder-window__patient"
          profiles={patients.snapshot()?.profiles ?? []}
          patientId={conversationSession.linkedPatientId()}
          unlocked={patients.snapshot() !== null}
          hint="Запись попадёт в карту пациента"
          onPatientChange={(id) => conversationSession.linkPatient(id)}
          onSnapshotChange={patients.setSnapshot}
        />
        <Show when={failure()}>
          <p class="recorder-window__error" role="alert">
            {failure()}
          </p>
        </Show>
        <Show when={recording()}>
          <LiveText />
        </Show>
      </div>
    </OverlayDialog>
  );
}

/** App-wide host: the floating button, the recorder window, the recording sheet, crash recovery. */
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
      <RecorderFab />
      <Show when={conversationSession.windowOpen()}>
        <RecorderWindow />
      </Show>
      <Show when={conversationSession.finished()}>
        {(recording) => (
          <Suspense>
            <ConversationRecordingSheet
              recording={recording()}
              onClose={() => conversationSession.dismissFinished()}
            />
          </Suspense>
        )}
      </Show>
    </>
  );
}
