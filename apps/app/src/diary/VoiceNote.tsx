import { createEffect, createSignal, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { saveVoiceClip } from '@/diary/voice-store';
import { createVoiceCapture } from '@/features/notes/voice-capture';

/** Whisper Base: the fast model, preferred for Russian (features/asr/asr-models.ts). */
const MODEL_ID = 'onnx-community/whisper-base';
const MODEL_MEGABYTES = 81;
/** Up to five minutes a message (owner 2026-11-08). */
export const MAX_VOICE_SECONDS = 300;
/** Speech needs little; the recording stays on the phone, so size only matters for its storage. */
const BITRATE = 16_000;
/** The privacy line under the microphone, until the first recording is done. */
const SEEN_KEY = 'minimed.diary.voiceNoteSeen';

type Phase = 'idle' | 'working' | 'offer' | 'downloading';
type AsrModule = typeof import('@/features/asr/asr-models');

/** What a recognised text came from: the length, the recogniser, the recording on this phone. */
export interface VoiceOrigin {
  readonly seconds: number;
  readonly engine: string;
  /** The recording's id in `voice-store`; absent when the phone could not keep it. */
  readonly clip?: string;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** `onnx-community/whisper-base` → `whisper-base`: the name the doctor sees. */
function engineName(modelId: string | null): string {
  return (modelId ?? MODEL_ID).split('/').at(-1) ?? 'whisper-base';
}

/** The privacy line has been shown and a recording made: it is not repeated. */
export function seenNote(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markNoteSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Without storage the line simply shows again next time.
  }
}

/**
 * «Сказать голосом»: the patient speaks (up to five minutes), the phone turns it into text with the
 * app's speech model and adds it to the field, where it can be corrected before saving. Only the
 * text goes to the doctor; the recording stays on this phone (`voice-store`, owner 2026-11-08).
 * Recognition runs while the sheet stays usable, with a cancel. The model (81 MB) is downloaded
 * once, after the patient agrees, the first time a recording needs it.
 */
export function VoiceNote(props: {
  readonly onText: (text: string, origin: VoiceOrigin) => void;
  /** A small round button beside a field: its name goes into the button's label. */
  readonly compact?: string;
}): JSX.Element {
  const [phase, setPhase] = createSignal<Phase>('idle');
  const [progress, setProgress] = createSignal<number | null>(null);
  const [error, setError] = createSignal('');
  const [kept, setKept] = createSignal('');
  const [elapsed, setElapsed] = createSignal(0);
  const [noteSeen, setNoteSeen] = createSignal(seenNote());
  let pending: { file: File; seconds: number; clip: string | undefined } | undefined;
  let stopProgress: (() => void) | undefined;
  let ticker: number | undefined;
  /** Bumped by «Отменить»: a recognition that finishes after it is dropped. */
  let run = 0;
  onCleanup(() => {
    stopProgress?.();
    window.clearInterval(ticker);
    run += 1;
  });

  const stopTicker = (): void => {
    window.clearInterval(ticker);
    ticker = undefined;
  };

  const fail = (cause: unknown, fallback: string): void => {
    stopTicker();
    setPhase('idle');
    setError(cause instanceof Error ? cause.message : fallback);
  };

  const transcribe = async (
    asr: AsrModule,
    recording: NonNullable<typeof pending>,
  ): Promise<void> => {
    run += 1;
    const mine = run;
    setPhase('working');
    setElapsed(0);
    stopTicker();
    ticker = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    const output = await asr.transcribeBlob(recording.file);
    if (mine !== run) return;
    stopTicker();
    pending = undefined;
    setPhase('idle');
    const text = output.text.trim();
    if (text) {
      props.onText(text, {
        seconds: recording.seconds,
        engine: engineName(asr.selectedAsrModelId()),
        ...(recording.clip ? { clip: recording.clip } : {}),
      });
    } else {
      setKept(
        'Слов не разобрать. Запись осталась на телефоне — скажите ещё раз, ближе к телефону.',
      );
    }
  };

  const handle = (file: File, seconds: number): void => {
    setError('');
    setKept('');
    setPhase('working');
    if (!noteSeen()) {
      markNoteSeen();
      setNoteSeen(true);
    }
    void (async () => {
      // The recording is kept on this phone first, whatever happens to the text.
      const clip = await saveVoiceClip(file, seconds).catch((cause: unknown) => {
        console.warn('Запись не сохранена на телефоне:', cause);
        return undefined;
      });
      const recording = { file, seconds, clip };
      const asr = await import('@/features/asr/asr-models');
      if (!asr.isAsrReady() && !(await asr.activateSelectedAsrModel())) {
        // The model is not on this phone yet: ask before downloading it.
        pending = recording;
        setPhase('offer');
        return;
      }
      await transcribe(asr, recording);
    })().catch((cause: unknown) => fail(cause, 'Не удалось расшифровать запись.'));
  };

  const download = (): void => {
    const recording = pending;
    if (!recording) return;
    setError('');
    setPhase('downloading');
    setProgress(null);
    void import('@/features/asr/asr-models')
      .then(async (asr) => {
        stopProgress?.();
        stopProgress = asr.onAsrProgress(MODEL_ID, setProgress);
        if (!asr.selectedAsrModelId()) asr.selectAsrModel(MODEL_ID);
        await asr.activateAsrModel(asr.selectedAsrModelId() ?? MODEL_ID);
        stopProgress();
        stopProgress = undefined;
        await transcribe(asr, recording);
      })
      .catch((cause: unknown) => fail(cause, 'Не удалось скачать речевую модель.'));
  };

  const cancel = (): void => {
    run += 1;
    stopTicker();
    pending = undefined;
    setPhase('idle');
    setKept('Расшифровка отменена. Запись осталась на телефоне.');
  };

  const capture = createVoiceCapture({
    maxSeconds: MAX_VOICE_SECONDS,
    bitrate: BITRATE,
    onStart: () => setError(''),
    onComplete: (file) => {
      const seconds = Math.max(1, lastSeconds);
      lastSeconds = 0;
      handle(file, seconds);
    },
    onError: (message) => setError(message),
  });
  // The capture resets its clock before handing the file over: remember the last second shown.
  let lastSeconds = 0;
  createEffect(() => {
    const seconds = capture.seconds();
    if (seconds > 0) lastSeconds = seconds;
  });

  const busy = (): boolean => phase() === 'working' || phase() === 'downloading';
  const label = (): string =>
    capture.recording()
      ? 'Остановить запись'
      : props.compact
        ? `Сказать голосом: ${props.compact}`
        : 'Сказать голосом';

  return (
    <div class="diary-voice" classList={{ 'diary-voice--compact': Boolean(props.compact) }}>
      <div class="diary-voice__row">
        <button
          type="button"
          class="diary-voice__button"
          classList={{
            'diary-voice__button--recording': capture.recording(),
            'diary-voice__button--busy': busy(),
            'diary-voice__button--small': Boolean(props.compact),
          }}
          aria-label={label()}
          disabled={busy() || phase() === 'offer'}
          onClick={() => void (capture.recording() ? capture.stop() : capture.start())}
        >
          <Show
            when={capture.recording()}
            fallback={<AppGlyph name="microphone" class="diary-voice__icon" />}
          >
            <span
              class="diary-voice__halo"
              style={{ '--voice-level': `${Math.round(capture.level() * 100)}%` }}
              aria-hidden="true"
            />
            <AppGlyph name="stop-circle" class="diary-voice__icon" />
          </Show>
        </button>
        <span class="diary-voice__status" role="status">
          <Show when={capture.recording()}>
            Говорите… {clock(capture.seconds())} из {clock(MAX_VOICE_SECONDS)}
          </Show>
          <Show when={!capture.recording() && phase() === 'idle' && !props.compact}>
            Сказать голосом
          </Show>
          <Show when={phase() === 'working'}>Превращаем голос в текст… {clock(elapsed())}</Show>
          <Show when={phase() === 'downloading'}>
            Скачиваем речевую модель
            {progress() === null ? '…' : ` · ${Math.round((progress() ?? 0) * 100)} %`}
          </Show>
        </span>
        <Show when={phase() === 'working'}>
          <button type="button" class="diary-voice__cancel" onClick={cancel}>
            Отменить
          </button>
        </Show>
      </div>
      <Show when={!noteSeen() && !props.compact && phase() === 'idle'}>
        <p class="diary-voice__privacy">Запись остаётся на телефоне, врачу уйдёт только текст.</p>
      </Show>
      <Show when={phase() === 'offer'}>
        <div class="diary-voice__offer">
          <p class="diary-voice__offer-text">
            Текст получится прямо на телефоне: нужна речевая модель, {MODEL_MEGABYTES} МБ, один раз.
            Запись никуда не отправляется.
          </p>
          <div class="diary-voice__actions">
            <button type="button" class="diary-voice__primary" onClick={download}>
              Скачать и расшифровать
            </button>
            <button
              type="button"
              class="diary-voice__secondary"
              onClick={() => {
                pending = undefined;
                setPhase('idle');
                setKept(
                  'Запись осталась на телефоне. Врачу уйдёт только текст — напишите его сами.',
                );
              }}
            >
              Не сейчас
            </button>
          </div>
        </div>
      </Show>
      <Show when={kept()}>
        <p class="diary-voice__kept" role="status">
          {kept()}
        </p>
      </Show>
      <Show when={error()}>
        <p class="diary-voice__error" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  );
}
