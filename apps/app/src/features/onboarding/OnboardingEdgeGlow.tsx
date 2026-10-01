import { createEffect, createSignal, type JSX, on, onCleanup, onMount, Show } from 'solid-js';

import { EdgeGlowEngine } from './edge-glow-engine';
import type { EdgeGlowWorkerMessage } from './edge-glow-protocol';
import { DARK_PALETTE, type GlowCanvasContext, LIGHT_PALETTE } from './edge-glow-renderer';

/** Rendering above this density only costs fill rate: the glow is soft anyway. */
const MAX_DPR = 2;

type GlowMode = 'worker' | 'main';

function supportsWorkerCanvas(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'transferControlToOffscreen' in HTMLCanvasElement.prototype
  );
}

/**
 * The particle layer of the edge glow. It draws on an OffscreenCanvas in a worker where the
 * browser allows it and on the page's own canvas otherwise, pauses while the page is hidden, and
 * renders nothing at all when animations are off (the steady CSS glow carries the effect then).
 */
export function OnboardingEdgeGlow(props: {
  /** Changes whenever the glow should flare (a step that asks for it begins). */
  readonly pulseKey: number;
}): JSX.Element {
  const [mode, setMode] = createSignal<GlowMode>(supportsWorkerCanvas() ? 'worker' : 'main');
  return (
    <Show when={mode()} keyed>
      {(current) => (
        <GlowCanvas
          mode={current}
          pulseKey={props.pulseKey}
          onWorkerFailed={() => setMode('main')}
        />
      )}
    </Show>
  );
}

function GlowCanvas(props: {
  readonly mode: GlowMode;
  readonly pulseKey: number;
  readonly onWorkerFailed: () => void;
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  let post: (message: EdgeGlowWorkerMessage) => void = () => undefined;
  let resizeNow: (() => void) | undefined;

  onMount(() => {
    const element = canvas;
    if (!element) return;
    const palette = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? DARK_PALETTE
      : LIGHT_PALETTE;
    const size = () => ({
      width: Math.max(1, Math.round(element.clientWidth)),
      height: Math.max(1, Math.round(element.clientHeight)),
      dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR),
    });
    let stop: () => void;
    if (props.mode === 'worker') {
      const worker = new Worker(new URL('./edge-glow.worker.ts', import.meta.url), {
        type: 'module',
      });
      const failed = (event: Event): void => {
        console.warn('Свечение по краям не запустилось в фоновом потоке.', event);
        props.onWorkerFailed();
      };
      worker.addEventListener('error', failed);
      const offscreen = element.transferControlToOffscreen();
      const initial = size();
      worker.postMessage(
        { type: 'init', canvas: offscreen, palette, ...initial } satisfies EdgeGlowWorkerMessage,
        [offscreen],
      );
      post = (message) => worker.postMessage(message);
      resizeNow = () => post({ type: 'resize', ...size() });
      stop = () => {
        worker.removeEventListener('error', failed);
        worker.postMessage({ type: 'stop' } satisfies EdgeGlowWorkerMessage);
        worker.terminate();
      };
    } else {
      const context = element.getContext('2d');
      if (!context) throw new Error('Не удалось получить 2D-контекст для свечения.');
      const engine = new EdgeGlowEngine(
        { canvas: element, context: context as unknown as GlowCanvasContext },
        palette,
        (callback) => requestAnimationFrame(callback),
        (handle) => cancelAnimationFrame(handle),
        () => performance.now(),
      );
      const initial = size();
      engine.resize(initial.width, initial.height, initial.dpr);
      post = (message) => {
        if (message.type === 'pulse') engine.pulse();
        else if (message.type === 'pause') engine.pause();
        else if (message.type === 'resume') engine.resume();
      };
      resizeNow = () => {
        const next = size();
        engine.resize(next.width, next.height, next.dpr);
      };
      stop = () => engine.stop();
    }
    const observer = new ResizeObserver(() => resizeNow?.());
    observer.observe(element);
    const onVisibility = (): void => post({ type: document.hidden ? 'pause' : 'resume' });
    document.addEventListener('visibilitychange', onVisibility);
    if (props.pulseKey > 0) post({ type: 'pulse' });
    onCleanup(() => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    });
  });

  createEffect(
    on(
      () => props.pulseKey,
      () => post({ type: 'pulse' }),
      { defer: true },
    ),
  );

  return (
    <canvas
      ref={(element) => {
        canvas = element;
      }}
      class="onboarding__particles"
    />
  );
}
