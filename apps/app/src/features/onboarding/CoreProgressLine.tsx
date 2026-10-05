import { createEffect, createMemo, createSignal, type JSX, on, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { motionMs } from '@/state/motion';
import { type CoreLineInput, coreLineState } from './core-line-state';
import { currentSpeed, nextSpeed, startSpeed } from './download-speed';

export type CoreProgressLineProps = Omit<CoreLineInput, 'speed'> & {
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
/** The speed text is recomputed this often even when no bytes arrive, so a stall clears it. */
const SPEED_REFRESH_MS = 1_000;

/**
 * The thin line along the bottom edge that follows the core download. It lives above the tour's
 * blur and outlives the tour; once the core is installed it fills, holds a moment and fades.
 */
export function CoreProgressLine(props: CoreProgressLineProps): JSX.Element {
  const [speedState, setSpeedState] = createSignal(startSpeed(performance.now(), 0));
  const [now, setNow] = createSignal(performance.now());
  const [leaving, setLeaving] = createSignal(false);
  const [gone, setGone] = createSignal(false);

  createEffect(
    on(
      () => props.progress?.loaded,
      (loaded) => {
        if (loaded === undefined) return;
        setSpeedState((state) => nextSpeed(state, performance.now(), loaded));
        setNow(performance.now());
      },
    ),
  );
  const refresh = setInterval(() => setNow(performance.now()), SPEED_REFRESH_MS);
  onCleanup(() => clearInterval(refresh));

  const state = createMemo(() =>
    coreLineState({
      ready: props.ready,
      downloading: props.downloading,
      deferred: props.deferred,
      error: props.error,
      progress: props.progress,
      speed:
        props.progress?.phase === undefined || props.progress.phase === 'downloading'
          ? currentSpeed(speedState(), now())
          : undefined,
    }),
  );

  const wide = () => !props.compact && (state().kind === 'deferred' || state().kind === 'error');

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
      return `Загрузка ядра знаний: ${Math.floor(current.fraction * 4) * 25} %`;
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
          }}
          aria-hidden={props.waiting ? 'true' : undefined}
        >
          <div
            class="core-progress-line__track"
            role="progressbar"
            aria-label="Загрузка ядра знаний"
            aria-valuemin={0}
            aria-valuemax={100}
            {...(state().fraction === undefined
              ? {}
              : { 'aria-valuenow': Math.round((state().fraction ?? 0) * 100) })}
          >
            <div
              class="core-progress-line__fill"
              classList={{
                'core-progress-line__fill--indeterminate': state().fraction === undefined,
              }}
              style={
                state().fraction === undefined
                  ? undefined
                  : { transform: `scaleX(${state().fraction})` }
              }
            />
          </div>
          <div
            class="core-progress-line__caption"
            classList={{ 'core-progress-line__caption--wide': wide() }}
          >
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
