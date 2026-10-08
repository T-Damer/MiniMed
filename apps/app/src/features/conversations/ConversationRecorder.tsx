import {
  createEffect,
  createResource,
  createSignal,
  For,
  type JSX,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { Portal } from 'solid-js/web';

import { AppGlyph } from '@/components/AppGlyph';
import { AsciiSpinner } from '@/components/AsciiSpinner';
import { Button } from '@/components/Button';
import { AsrModelCard } from '@/features/asr/AsrModelCard';
import { asrInstall } from '@/features/asr/asr-model-install';
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
import { toastMicrophoneError } from '@/features/conversations/microphone-toast';
import { PulseDots } from '@/features/conversations/PulseDots';

/** The patient picker is heavy and needed only after a recording ends: loaded on demand. */
const ConversationAttachDialog = lazy(() =>
  import('@/features/conversations/ConversationAttachDialog').then((module) => ({
    default: module.ConversationAttachDialog,
  })),
);

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
function VaultSuggestion(props: {
  readonly state: TranscriptSaveState;
  readonly roomy: boolean;
}): JSX.Element {
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
          classList={{
            'conversation-offer__chip--roomy': props.roomy,
            'conversation-offer__chip--failed': failure() !== '',
          }}
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
 * The expanded activity: the shared floating-window frame (toolbar, full-screen toggle) around the
 * timer, the level meter, the live text as it appears and the stop control. Without a speech model
 * the text area is the install card; once the model is ready the text takes its place.
 */
function RecordingWindow(): JSX.Element {
  let text: HTMLDivElement | undefined;
  const fullscreen = () => conversationSession.windowFullscreen();
  const recording = (): boolean => conversationSession.recorder() !== null;
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
          aria-label={recording() ? 'Идёт запись беседы' : 'Запись беседы'}
          data-testid="conversation-live"
        >
          <header
            class="floating-window__toolbar"
            classList={{ 'floating-window__toolbar--fullscreen': fullscreen() }}
          >
            <button
              class="floating-window__button"
              type="button"
              aria-label={recording() ? 'Свернуть в строку записи' : 'Закрыть'}
              title={recording() ? 'Свернуть в строку записи' : 'Закрыть'}
              onClick={() => conversationSession.closeWindow()}
            >
              <AppGlyph name={recording() ? 'caret-down' : 'close'} class="floating-window__icon" />
            </button>
            <strong class="floating-window__title">
              {recording() ? 'Идёт запись беседы' : 'Запись беседы'}
            </strong>
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
            <Show
              when={recording()}
              fallback={
                <div class="conversation-live__ready">
                  <button
                    type="button"
                    class="conversation-live__record"
                    aria-label="Начать запись"
                    title="Начать запись"
                    disabled={conversationSession.starting()}
                    onClick={() => void startConversation()}
                  >
                    <Show
                      when={!conversationSession.starting()}
                      fallback={<AsciiSpinner class="conversation-live__record-spinner" />}
                    >
                      <AppGlyph name="microphone" class="conversation-live__record-icon" />
                    </Show>
                  </button>
                </div>
              }
            >
              <div class="conversation-live__head">
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
                <VaultSuggestion state={conversationSession.saveState()} roomy={fullscreen()} />
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
                    <ol
                      class="conversation-live__lines"
                      aria-label="Текст беседы"
                      aria-live="polite"
                    >
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
            </Show>
          </div>
        </section>
      </section>
    </Portal>
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
      <Show when={conversationSession.windowOpen()}>
        <RecordingWindow />
      </Show>
      <Show when={conversationSession.finished()}>
        {(recording) => (
          <Suspense>
            <ConversationAttachDialog
              recording={recording()}
              onClose={() => conversationSession.dismissFinished()}
            />
          </Suspense>
        )}
      </Show>
    </>
  );
}
