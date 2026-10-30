import { createSignal, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { createVoiceCapture } from '@/features/notes/voice-capture';

/** Whisper Base: the fast model, preferred for Russian (features/asr/asr-models.ts). */
const MODEL_ID = 'onnx-community/whisper-base';
const MODEL_MEGABYTES = 81;
/** A voice note is a few sentences; three minutes is plenty and keeps on-device decoding quick. */
const MAX_SECONDS = 180;

type Phase = 'idle' | 'working' | 'offer' | 'downloading';
type AsrModule = typeof import('@/features/asr/asr-models');

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * «Сказать голосом» in the patient's own-words sheet: the patient speaks, the phone turns it into
 * text with the app's speech model and adds it to the field, where it can be corrected before
 * saving. The recording never leaves the phone and is not kept. The model (81 MB) is downloaded
 * once, after the patient agrees, the first time a recording needs it.
 */
export function VoiceNote(props: { readonly onText: (text: string) => void }): JSX.Element {
  const [phase, setPhase] = createSignal<Phase>('idle');
  const [progress, setProgress] = createSignal<number | null>(null);
  const [error, setError] = createSignal('');
  let pending: File | undefined;
  let stopProgress: (() => void) | undefined;
  onCleanup(() => stopProgress?.());

  const fail = (cause: unknown, fallback: string): void => {
    setPhase('idle');
    setError(cause instanceof Error ? cause.message : fallback);
  };

  const transcribe = async (asr: AsrModule, file: File): Promise<void> => {
    setPhase('working');
    const output = await asr.transcribeBlob(file);
    const text = output.text.trim();
    pending = undefined;
    setPhase('idle');
    if (text) props.onText(text);
    else setError('Не удалось разобрать слова. Попробуйте ещё раз, ближе к телефону.');
  };

  const handle = (file: File): void => {
    setError('');
    setPhase('working');
    void import('@/features/asr/asr-models')
      .then(async (asr) => {
        if (!asr.isAsrReady() && !(await asr.activateSelectedAsrModel())) {
          // The model is not on this phone yet: ask before downloading it.
          pending = file;
          setPhase('offer');
          return;
        }
        await transcribe(asr, file);
      })
      .catch((cause: unknown) => fail(cause, 'Не удалось расшифровать запись.'));
  };

  const download = (): void => {
    const file = pending;
    if (!file) return;
    setError('');
    setPhase('downloading');
    setProgress(null);
    void import('@/features/asr/asr-models')
      .then(async (asr) => {
        stopProgress?.();
        stopProgress = asr.onAsrProgress(MODEL_ID, setProgress);
        await asr.activateAsrModel(MODEL_ID);
        stopProgress();
        stopProgress = undefined;
        await transcribe(asr, file);
      })
      .catch((cause: unknown) => fail(cause, 'Не удалось скачать речевую модель.'));
  };

  const capture = createVoiceCapture({
    maxSeconds: MAX_SECONDS,
    bitrate: 32_000,
    onStart: () => setError(''),
    onComplete: handle,
    onError: (message) => setError(message),
  });

  const busy = (): boolean => phase() === 'working' || phase() === 'downloading';

  return (
    <div class="diary-voice">
      <div class="diary-voice__row">
        <button
          type="button"
          class="diary-voice__button"
          classList={{
            'diary-voice__button--recording': capture.recording(),
            'diary-voice__button--busy': busy(),
          }}
          aria-label={capture.recording() ? 'Остановить запись' : 'Сказать голосом'}
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
          <Show when={capture.recording()}>Говорите… {clock(capture.seconds())}</Show>
          <Show when={!capture.recording() && phase() === 'idle'}>Сказать голосом</Show>
          <Show when={phase() === 'working'}>Превращаем голос в текст…</Show>
          <Show when={phase() === 'downloading'}>
            Скачиваем речевую модель
            {progress() === null ? '…' : ` · ${Math.round((progress() ?? 0) * 100)} %`}
          </Show>
        </span>
      </div>
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
              }}
            >
              Не сейчас
            </button>
          </div>
        </div>
      </Show>
      <Show when={error()}>
        <p class="diary-voice__error" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  );
}
