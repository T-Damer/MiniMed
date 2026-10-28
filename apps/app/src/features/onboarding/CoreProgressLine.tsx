import { createEffect, createMemo, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { motionMs } from '@/state/motion';
import { type CoreLineInput, coreLineState } from './core-line-state';

export type CoreProgressLineProps = CoreLineInput & {
  readonly onDownload: () => void;
  /** The download has not been allowed to begin yet (the app is still being introduced): hidden. */
  readonly waiting?: boolean;
  /**
   * The onboarding is on screen: the caption stays a small pill in the bottom corner, where the
   * tour keeps clear, instead of a wide message over the middle of the screen.
   */
  readonly compact?: boolean;
  /** The line has finished and faded: nothing of the core download remains on screen. */
  readonly onGone?: () => void;
};

/** How long the completed line stays before it fades. */
const READY_HOLD_MS = 900;

/**
 * The thin line along the bottom edge that follows the core download. It lives above the tour's
 * blur and outlives the tour; once the core is installed it fills, holds a moment and fades.
 */
export function CoreProgressLine(props: CoreProgressLineProps): JSX.Element {
  const [leaving, setLeaving] = createSignal(false);
  const [gone, setGone] = createSignal(false);

  const state = createMemo(() =>
    coreLineState({
      ready: props.ready,
      downloading: props.downloading,
      deferred: props.deferred,
      error: props.error,
      progress: props.progress,
    }),
  );

  const wide = () => !props.compact && (state().kind === 'deferred' || state().kind === 'error');
  // Outside the tour the progress is one small pill centred under the bottom bar, filling as the
  // download runs (owner 2026-10-28: the corner chip and the edge line hid in the screen's curve).
  const pill = () => !props.compact && !wide();
  const fillStyle = (): JSX.CSSProperties | undefined => {
    const fraction = state().fraction;
    return fraction === undefined ? undefined : { transform: `scaleX(${fraction})` };
  };
  // Before the first byte the search field says the same in its own words («Подготавливаем
  // поиск…», «Соединяемся с сервером…»): the pill stays quiet until it has a number to add.
  const quiet = () => state().kind === 'preparing' || state().kind === 'connecting';

  createEffect(() => {
    if (!props.ready) return;
    const hold = setTimeout(() => setLeaving(true), READY_HOLD_MS);
    onCleanup(() => clearTimeout(hold));
  });
  createEffect(() => {
    if (!leaving()) return;
    const fade = setTimeout(
      () => {
        setGone(true);
        props.onGone?.();
      },
      Math.max(60, motionMs(420)),
    );
    onCleanup(() => clearTimeout(fade));
  });

  // Screen readers hear the stages and every quarter, not every percent.
  const announcement = createMemo(() => {
    const current = state();
    if (current.kind === 'downloading' && current.fraction !== undefined) {
      return `Загрузка основной базы: ${Math.floor(current.fraction * 4) * 25} %`;
    }
    return current.label;
  });

  return (
    <Show when={!gone()}>
      <Portal>
        <div
          class="core-progress-line"
          classList={{
            [`core-progress-line--${state().kind}`]: true,
            'core-progress-line--leaving': leaving(),
            'core-progress-line--waiting': props.waiting === true,
            'core-progress-line--under-nav': pill(),
          }}
          aria-hidden={props.waiting ? 'true' : undefined}
        >
          <div
            class="core-progress-line__track"
            classList={{ 'core-progress-line__track--pill': pill() }}
            role="progressbar"
            aria-label="Загрузка основной базы"
            aria-valuemin={0}
            aria-valuemax={100}
            {...(state().fraction === undefined
              ? {}
              : { 'aria-valuenow': Math.round((state().fraction ?? 0) * 100) })}
          >
            <Show when={!pill()}>
              <div
                class="core-progress-line__fill"
                classList={{
                  'core-progress-line__fill--indeterminate': state().fraction === undefined,
                }}
                style={fillStyle()}
              />
            </Show>
          </div>
          <div
            class="core-progress-line__caption"
            classList={{
              'core-progress-line__caption--wide': wide(),
              'core-progress-line__caption--quiet': quiet(),
              'core-progress-line__caption--pill': pill(),
            }}
          >
            <Show when={pill()}>
              <span class="core-progress-line__pill-track" aria-hidden="true">
                <span
                  class="core-progress-line__fill core-progress-line__fill--pill"
                  classList={{
                    'core-progress-line__fill--indeterminate': state().fraction === undefined,
                  }}
                  style={fillStyle()}
                />
              </span>
            </Show>
            <span class="core-progress-line__label" aria-hidden="true">
              {props.compact ? state().compactLabel : state().label}
            </span>
            <Show when={state().kind === 'deferred'}>
              <button class="core-progress-line__action" type="button" onClick={props.onDownload}>
                Скачать
              </button>
            </Show>
            <Show when={state().kind === 'error'}>
              <button
                class="core-progress-line__action"
                type="button"
                onClick={() => window.location.reload()}
              >
                Повторить
              </button>
            </Show>
          </div>
          <span class="sr-only" role="status" aria-live="polite">
            {announcement()}
          </span>
        </div>
      </Portal>
    </Show>
  );
}
