import { For, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import {
  asrInstall,
  formatModelSize,
  installAsrModel,
  watchAsrInstall,
} from '@/features/asr/asr-model-install';

import '@/features/asr/asr-model-card.css';

const WAVE_BARS = [0, 1, 2, 3, 4] as const;
const TEXT_LINES = [0, 1, 2] as const;

/** Voice turning into text: a microphone, a few moving bars and lines of text appearing. */
function VoiceToTextArt(props: { readonly busy: boolean }): JSX.Element {
  return (
    <span
      class="asr-model-art"
      classList={{ 'asr-model-art--busy': props.busy }}
      aria-hidden="true"
    >
      <span class="asr-model-art__tile">
        <AppGlyph name="microphone" class="asr-model-art__glyph" />
      </span>
      <span class="asr-model-art__wave">
        <For each={WAVE_BARS}>
          {(index) => (
            <span class="asr-model-art__bar" style={{ '--asr-art-index': String(index) }} />
          )}
        </For>
      </span>
      <span class="asr-model-art__tile asr-model-art__tile--text">
        <For each={TEXT_LINES}>
          {(index) => (
            <span class="asr-model-art__line" style={{ '--asr-art-index': String(index) }} />
          )}
        </For>
      </span>
    </span>
  );
}

/**
 * Offers the on-device speech model in place: a picture, one sentence and one button that turns
 * into its own progress while the model downloads. Nothing around it is blocked.
 */
export function AsrModelCard(props: {
  readonly compact?: boolean;
  readonly class?: string;
}): JSX.Element {
  onCleanup(watchAsrInstall());
  const phase = asrInstall.phase;
  const loading = () => phase() === 'loading';
  const percent = (): number | null => {
    const fraction = asrInstall.progress();
    return fraction === null ? null : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  };
  const size = (): string => {
    const bytes = asrInstall.model()?.downloadBytes;
    return bytes === undefined ? '' : ` · ${formatModelSize(bytes)}`;
  };
  const label = (): string => {
    if (loading() && asrInstall.retrying()) return 'Повторяем';
    if (loading()) return percent() === null ? 'Загружаем' : `${percent()}%`;
    if (phase() === 'failed') return 'Повторить';
    if (phase() === 'cached') return 'Включить';
    return `Скачать${size()}`;
  };
  return (
    <div
      class={`asr-model-card ${props.class ?? ''}`.trim()}
      classList={{ 'asr-model-card--compact': props.compact === true }}
      data-phase={phase()}
    >
      <VoiceToTextArt busy={loading()} />
      <p class="asr-model-card__title">
        {phase() === 'cached' ? 'Включите' : 'Загрузите'} модель, чтобы голос автоматически
        превращался в текст
      </p>
      <button
        type="button"
        class="ui-button ui-button--primary asr-model-card__action"
        classList={{ 'asr-model-card__action--busy': loading() }}
        aria-disabled={loading()}
        aria-label={loading() ? `Загрузка модели, ${label()}` : label()}
        onClick={() => {
          if (!loading()) void installAsrModel();
        }}
      >
        <span
          class="asr-model-card__fill"
          style={{ '--asr-model-progress': String((percent() ?? 0) / 100) }}
        />
        <span class="asr-model-card__action-icon">
          <Show
            when={loading()}
            fallback={
              <AppGlyph
                name={
                  phase() === 'failed' ? 'refresh' : phase() === 'cached' ? 'check' : 'download'
                }
                class="asr-model-card__glyph"
              />
            }
          >
            <span class="asr-model-card__spinner" />
          </Show>
        </span>
        <span class="asr-model-card__action-label">{label()}</span>
      </button>
      <Show when={phase() === 'failed' && asrInstall.error()}>
        {(message) => (
          <p class="asr-model-card__error" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </div>
  );
}
