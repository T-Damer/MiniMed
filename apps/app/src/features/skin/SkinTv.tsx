import { createEffect, createSignal, For, type JSX, on, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import {
  activeZoomChip,
  type SkinCameraSession,
  startSkinCamera,
  zoomChipLabel,
  zoomChipValues,
} from '@/features/skin/skin-camera';
import { squareJpeg, squareJpegFromBlob } from '@/features/skin/skin-crop';
import type { SkinPhase } from '@/features/skin/skin-session';
import { motionMs } from '@/state/motion';

import '@/styles/skin-tv.css';

/** The camera feed, or its absence, as the screen shows it. */
type ScreenFeed = 'starting' | 'live' | 'static';

const SCAN_LINE_MS = 850;

/**
 * The camera window, drawn as a small retro TV. Its screen is the square the model sees: the live
 * feed while there is one, snow (with the upload door) while there is none, then the frozen photo.
 * Tapping the screen of an idle TV always offers a file; the knobs are real controls that exist only
 * when the device reports the capability behind them (zoom steps, torch, close focus).
 */
export function SkinTv(props: {
  readonly phase: SkinPhase;
  /** The frozen square photo, once taken. */
  readonly photoUrl: string | undefined;
  /** Smaller, while the results are shown under it. */
  readonly compact: boolean;
  /** Status lines the scan cycles through. */
  readonly scanLines: readonly string[];
  readonly onPhoto: (photo: Blob) => void;
  readonly onRetake: () => void;
  readonly onAnalyze: () => void;
}): JSX.Element {
  const [feed, setFeed] = createSignal<ScreenFeed>('starting');
  const [session, setSession] = createSignal<SkinCameraSession>();
  const [zoom, setZoom] = createSignal<number>();
  const [torch, setTorch] = createSignal(false);
  const [macro, setMacro] = createSignal(false);
  const [lineIndex, setLineIndex] = createSignal(0);
  const [capturing, setCapturing] = createSignal(false);
  let video: HTMLVideoElement | undefined;
  let fileInput: HTMLInputElement | undefined;
  let attempt = 0;

  const idle = (): boolean => props.phase === 'idle';
  const live = (): boolean => idle() && feed() === 'live' && session() !== undefined;
  const zoomChips = (): readonly number[] => zoomChipValues(session()?.controls.zoom);

  const stopCamera = (): void => {
    attempt += 1;
    session()?.stop();
    setSession(undefined);
    setTorch(false);
    setMacro(false);
    setZoom(undefined);
    if (video) video.srcObject = null;
  };

  const startCamera = async (): Promise<void> => {
    if (session()) return;
    const mine = ++attempt;
    setFeed('starting');
    const result = await startSkinCamera();
    if (mine !== attempt || !idle()) {
      if (result.kind === 'live') result.session.stop();
      return;
    }
    if (result.kind === 'failed') {
      setFeed('static');
      return;
    }
    setSession(result.session);
    setZoom(result.session.currentZoom());
    setFeed('live');
  };

  // The feed follows the video element and the session, whichever arrives last.
  createEffect(() => {
    const current = session();
    if (video && current) {
      video.srcObject = current.stream;
      void video.play().catch(() => undefined);
    }
  });
  // The camera runs only while the TV waits for a shot.
  createEffect(
    on(idle, (isIdle) => {
      if (isIdle) void startCamera();
      else stopCamera();
    }),
  );
  onMount(() => {
    const onVisibility = (): void => {
      if (document.hidden) stopCamera();
      else if (idle()) void startCamera();
    };
    document.addEventListener('visibilitychange', onVisibility);
    onCleanup(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopCamera();
    });
  });

  // The scan reads its status lines one after another.
  createEffect(() => {
    if (props.phase !== 'scanning') return;
    setLineIndex(0);
    const timer = window.setInterval(
      () => setLineIndex((index) => Math.min(index + 1, props.scanLines.length - 1)),
      motionMs(SCAN_LINE_MS) || SCAN_LINE_MS,
    );
    onCleanup(() => window.clearInterval(timer));
  });

  const openPicker = (): void => fileInput?.click();

  const takeFile = async (event: Event & { currentTarget: HTMLInputElement }): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      props.onPhoto(await squareJpegFromBlob(file));
    } catch {
      toast.error('Не удалось открыть снимок.');
    }
  };

  const shoot = async (): Promise<void> => {
    if (!live() || !video || capturing()) return;
    setCapturing(true);
    try {
      props.onPhoto(await squareJpeg(video));
    } catch {
      toast.error('Не удалось снять кадр.');
    } finally {
      setCapturing(false);
    }
  };

  const chooseZoom = async (value: number): Promise<void> => {
    try {
      await session()?.setZoom(value);
      setZoom(value);
    } catch {
      toast.error('Камера не приняла масштаб.');
    }
  };
  const toggleTorch = async (): Promise<void> => {
    const next = !torch();
    try {
      await session()?.setTorch(next);
      setTorch(next);
    } catch {
      toast.error('Вспышка недоступна.');
    }
  };
  const toggleMacro = async (): Promise<void> => {
    const next = !macro();
    try {
      await session()?.setMacro(next);
      setMacro(next);
    } catch {
      toast.error('Камера не приняла близкий фокус.');
    }
  };

  return (
    <section
      class="skin-tv"
      classList={{ 'skin-tv--compact': props.compact }}
      aria-label="Камера"
      data-phase={props.phase}
    >
      <span
        class="skin-tv__antenna skin-tv__antenna--left"
        classList={{ 'skin-tv__antenna--hidden': props.compact }}
        aria-hidden="true"
      />
      <span
        class="skin-tv__antenna skin-tv__antenna--right"
        classList={{ 'skin-tv__antenna--hidden': props.compact }}
        aria-hidden="true"
      />
      <div class="skin-tv__body" classList={{ 'skin-tv__body--compact': props.compact }}>
        <div class="skin-tv__screen" data-testid="skin-screen" data-feed={live() ? 'live' : feed()}>
          <video
            ref={(element) => {
              video = element;
              const current = session();
              if (current) element.srcObject = current.stream;
            }}
            class="skin-tv__video"
            classList={{ 'skin-tv__video--shown': live() }}
            muted
            playsinline
            autoplay
          />
          <Show when={idle() && !live()}>
            <span class="skin-tv__snow" aria-hidden="true" />
          </Show>
          <Show when={props.photoUrl} keyed>
            {(url) => (
              <img
                class="skin-tv__photo"
                classList={{ 'skin-tv__photo--scanning': props.phase === 'scanning' }}
                src={url}
                alt="Снимок кожи"
                data-testid="skin-photo"
              />
            )}
          </Show>
          <Show when={props.phase === 'scanning'}>
            <div class="skin-tv__scan" aria-hidden="true" data-testid="skin-scan">
              <span class="skin-tv__scan-grid" />
              <span class="skin-tv__scan-line" />
              <span class="skin-tv__scan-reticle" />
              <p class="skin-tv__scan-status">
                <For each={[props.scanLines[lineIndex()] ?? '']}>
                  {(line) => <span class="skin-tv__scan-text">{line}</span>}
                </For>
              </p>
            </div>
          </Show>
          <span class="skin-tv__glass" aria-hidden="true" />
          <Show when={idle()}>
            <label class="skin-tv__pick" data-testid="skin-pick">
              <span
                class="skin-tv__pick-label"
                classList={{ 'skin-tv__pick-label--hidden': feed() !== 'static' }}
              >
                {feed() === 'static' ? 'Нажмите, чтобы загрузить фото' : 'Загрузить фото'}
              </span>
              <input
                ref={(element) => {
                  fileInput = element;
                }}
                class="skin-tv__file"
                type="file"
                accept="image/*"
                aria-label="Загрузить фото"
                data-testid="skin-file"
                onChange={(event) => void takeFile(event)}
              />
              <AppGlyph
                name="image"
                class={
                  feed() === 'static'
                    ? 'skin-tv__pick-icon skin-tv__pick-icon--hint'
                    : 'skin-tv__pick-icon'
                }
              />
            </label>
          </Show>
          <Show when={live() && zoomChips().length > 1}>
            <fieldset class="skin-tv__zoom" aria-label="Масштаб">
              <For each={zoomChips()}>
                {(chip) => (
                  <button
                    type="button"
                    class="skin-tv__zoom-chip"
                    classList={{
                      'skin-tv__zoom-chip--active':
                        activeZoomChip(zoomChips(), zoom() ?? 1) === chip,
                    }}
                    aria-pressed={activeZoomChip(zoomChips(), zoom() ?? 1) === chip}
                    onClick={() => void chooseZoom(chip)}
                  >
                    {zoomChipLabel(chip)}
                  </button>
                )}
              </For>
            </fieldset>
          </Show>
        </div>

        <div class="skin-tv__chin">
          <div class="skin-tv__chin-start">
            <span
              class="skin-tv__led"
              classList={{
                'skin-tv__led--live': live(),
                'skin-tv__led--busy': props.phase === 'scanning',
              }}
              aria-hidden="true"
            />
            <Show when={live() && session()?.controls.torch}>
              <button
                type="button"
                class="skin-tv__knob"
                classList={{ 'skin-tv__knob--on': torch() }}
                aria-label="Вспышка"
                aria-pressed={torch()}
                data-testid="skin-torch"
                onClick={() => void toggleTorch()}
              >
                <AppGlyph name="lightning" class="skin-tv__knob-icon" />
              </button>
            </Show>
            <Show when={live() && session()?.controls.focusDistance}>
              <button
                type="button"
                class="skin-tv__knob"
                classList={{ 'skin-tv__knob--on': macro() }}
                aria-label="Близкий фокус"
                aria-pressed={macro()}
                data-testid="skin-macro"
                onClick={() => void toggleMacro()}
              >
                <AppGlyph name="magnifying-glass-plus" class="skin-tv__knob-icon" />
              </button>
            </Show>
          </div>
          <div class="skin-tv__chin-middle">
            <Show when={idle()}>
              <button
                type="button"
                class="skin-tv__shutter"
                classList={{ 'skin-tv__shutter--upload': !live() }}
                aria-label={live() ? 'Снять' : 'Загрузить фото'}
                data-testid="skin-shutter"
                disabled={capturing()}
                onClick={() => (live() ? void shoot() : openPicker())}
              >
                <Show
                  when={live()}
                  fallback={<AppGlyph name="image" class="skin-tv__shutter-icon" />}
                >
                  <span class="skin-tv__shutter-ring" />
                </Show>
              </button>
            </Show>
            <Show when={!idle()}>
              <button
                type="button"
                class="skin-tv__action"
                aria-label="Переснять"
                data-testid="skin-retake"
                onClick={props.onRetake}
              >
                <AppGlyph name="arrow-counter-clockwise" class="skin-tv__action-icon" />
                <span
                  class="skin-tv__action-label"
                  classList={{ 'skin-tv__action-label--hidden': props.compact }}
                >
                  Переснять
                </span>
              </button>
              <Show when={props.phase === 'captured' || props.phase === 'scanning'}>
                <button
                  type="button"
                  class="skin-tv__action skin-tv__action--primary"
                  data-testid="skin-analyze"
                  aria-busy={props.phase === 'scanning'}
                  disabled={props.phase === 'scanning'}
                  onClick={props.onAnalyze}
                >
                  <AppGlyph name="search" class="skin-tv__action-icon" />
                  Анализ
                </button>
              </Show>
            </Show>
          </div>
          <div class="skin-tv__chin-end">
            <Show when={idle() && live()}>
              <button
                type="button"
                class="skin-tv__knob"
                aria-label="Из галереи"
                onClick={openPicker}
              >
                <AppGlyph name="image" class="skin-tv__knob-icon" />
              </button>
            </Show>
          </div>
        </div>
      </div>
    </section>
  );
}
