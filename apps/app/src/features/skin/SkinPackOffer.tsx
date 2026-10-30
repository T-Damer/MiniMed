import { type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import type { SkinPackController } from '@/features/skin/use-skin-pack';
import { formatByteSize } from '@/i18n/format-number';

import '@/styles/skin-pack.css';

/**
 * The download of the skin pack in place: one compact control with the size, progress inside it,
 * nothing blocked. Tapping it is the person's consent to the download; while it runs the same tap
 * cancels. Hidden when the pack is installed or no pack is published.
 */
export function SkinPackOffer(props: { readonly pack: SkinPackController }): JSX.Element {
  const state = (): 'idle' | 'queued' | 'downloading' | 'checking' | 'installing' | 'failed' => {
    const task = props.pack.task();
    if (props.pack.busy() === 'download') {
      if (task?.state === 'queued') return 'queued';
      if (task?.state === 'verifying') return 'checking';
      if (task?.state === 'installing') return 'installing';
      return 'downloading';
    }
    return props.pack.error() || task?.state === 'failed' ? 'failed' : 'idle';
  };
  const percent = (): number => Math.floor(props.pack.fraction() * 100);
  const label = (): string => {
    switch (state()) {
      case 'queued':
        return 'В очереди';
      case 'downloading':
        return `Скачивается · ${percent()}%`;
      case 'checking':
        return 'Проверяем…';
      case 'installing':
        return 'Устанавливаем…';
      case 'failed':
        return 'Не удалось скачать · Повторить';
      default:
        return `Скачать модель · ${formatByteSize(props.pack.offer()?.downloadBytes ?? 0)}`;
    }
  };
  const running = (): boolean => state() !== 'idle' && state() !== 'failed';
  const cancellable = (): boolean => running() && (props.pack.task()?.canCancel ?? false);
  return (
    <Show when={props.pack.offer() && !props.pack.installed()}>
      <button
        type="button"
        class="skin-pack-offer"
        classList={{ 'skin-pack-offer--busy': running() }}
        data-testid="skin-pack-offer"
        data-state={state()}
        aria-label={cancellable() ? 'Отменить загрузку' : undefined}
        disabled={running() && !cancellable()}
        style={{ '--skin-pack-fill': String(props.pack.fraction()) }}
        onClick={() => {
          if (running()) props.pack.cancel();
          else void props.pack.install();
        }}
      >
        <span class="skin-pack-offer__bar" aria-hidden="true" />
        <AppGlyph
          name={cancellable() ? 'close' : state() === 'failed' ? 'refresh' : 'download'}
          class="skin-pack-offer__icon"
        />
        <span class="skin-pack-offer__text">{label()}</span>
      </button>
    </Show>
  );
}
