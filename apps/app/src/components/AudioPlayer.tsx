import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { formatRecordingDuration } from '@/features/asr/visit-recording';
import { resolveRecordedDuration } from '@/features/conversations/recorded-duration';
import { peakHeight, resamplePeaks } from '@/features/conversations/recording-audio';

import '@/components/audio-player.css';

export interface AudioPlayerSegment {
  readonly startMs?: number;
  readonly endMs?: number;
  readonly text: string;
}

const SPEEDS = [1, 1.25, 1.5, 2, 0.75] as const;
const SKIP_SECONDS = 15;
const BAR = 3;
const GAP = 2;

function speedLabel(speed: number): string {
  return `${String(speed).replace('.', ',')}×`;
}

/**
 * The app's audio player (REC1, owner 2026-11-13 «обычный браузерный плеер»): a round play button,
 * the recording's waveform — drawn once from peaks computed when it was recorded (or decoded once
 * and saved) — that seeks on a tap and scrubs on a drag, ±15 s, playback speed, and the transcript
 * following the playback when its segments carry times: the current one is marked and kept in
 * view, a tap on one plays from there. The `<audio>` element underneath has no controls of its own.
 */
export function AudioPlayer(props: {
  readonly src: string;
  readonly label: string;
  /** The recording's length when known (a MediaRecorder file does not say it in its header). */
  readonly durationMs?: number;
  readonly peaks?: readonly number[];
  readonly segments?: readonly AudioPlayerSegment[];
  readonly class?: string;
}): JSX.Element {
  let audio: HTMLAudioElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let transcript: HTMLOListElement | undefined;
  const [playing, setPlaying] = createSignal(false);
  const [currentMs, setCurrentMs] = createSignal(0);
  const [mediaMs, setMediaMs] = createSignal(0);
  const [speed, setSpeed] = createSignal<number>(1);
  const [scrubMs, setScrubMs] = createSignal<number | null>(null);
  const durationMs = (): number => props.durationMs || mediaMs();
  const shownMs = (): number => scrubMs() ?? currentMs();
  const fraction = (): number => (durationMs() > 0 ? Math.min(1, shownMs() / durationMs()) : 0);

  const timed = createMemo(() =>
    (props.segments ?? []).every((segment) => segment.startMs !== undefined),
  );
  const activeIndex = createMemo(() => {
    if (!timed()) return -1;
    const at = currentMs();
    const segments = props.segments ?? [];
    let found = -1;
    for (let index = 0; index < segments.length; index += 1) {
      if ((segments[index]?.startMs ?? 0) <= at) found = index;
      else break;
    }
    return found;
  });

  // ---- waveform --------------------------------------------------------------------------
  let width = 0;
  let height = 0;
  let scale = 1;
  let bars: number[] = [];
  let colors = { played: '', rest: '' };
  const readColors = (): void => {
    if (!canvas) return;
    const style = getComputedStyle(canvas);
    colors = {
      played: style.getPropertyValue('--audio-player-played').trim() || style.color,
      rest: style.getPropertyValue('--audio-player-rest').trim() || style.color,
    };
  };
  const draw = (): void => {
    const context = canvas?.getContext('2d');
    if (!canvas || !context || width === 0) return;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width, height);
    const split = fraction() * width;
    for (let index = 0; index < bars.length; index += 1) {
      const x = index * (BAR + GAP);
      const barHeight = Math.max(2, peakHeight(bars[index] ?? 0) * height);
      context.fillStyle = x + BAR / 2 <= split ? colors.played : colors.rest;
      context.beginPath();
      context.roundRect(x, (height - barHeight) / 2, BAR, barHeight, BAR / 2);
      context.fill();
    }
  };
  const resize = (): void => {
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    scale = Math.min(3, window.devicePixelRatio || 1);
    width = Math.max(1, Math.round(box.width));
    height = Math.max(1, Math.round(box.height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    bars = resamplePeaks(props.peaks ?? [], Math.max(1, Math.floor((width + GAP) / (BAR + GAP))));
    readColors();
    draw();
  };
  createEffect(on(() => props.peaks, resize, { defer: true }));
  createEffect(on(fraction, draw));

  // While playing, the position is followed per frame (only then: a paused player draws nothing).
  let frame = 0;
  const follow = (): void => {
    if (audio) setCurrentMs(audio.currentTime * 1000);
    frame = requestAnimationFrame(follow);
  };
  createEffect(() => {
    if (!playing()) {
      cancelAnimationFrame(frame);
      return;
    }
    frame = requestAnimationFrame(follow);
  });

  onMount(() => {
    if (!canvas) return;
    const sizes = new ResizeObserver(resize);
    sizes.observe(canvas);
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = (): void => {
      readColors();
      draw();
    };
    scheme.addEventListener('change', onScheme);
    onCleanup(() => {
      sizes.disconnect();
      scheme.removeEventListener('change', onScheme);
    });
  });
  onCleanup(() => {
    cancelAnimationFrame(frame);
    audio?.pause();
  });

  // The current segment stays in view inside the transcript, never by scrolling the page.
  createEffect(
    on(activeIndex, (index) => {
      if (index < 0 || !transcript) return;
      const item = transcript.children[index];
      if (!(item instanceof HTMLElement)) return;
      const top = item.offsetTop - transcript.offsetTop;
      if (
        top < transcript.scrollTop ||
        top + item.offsetHeight > transcript.scrollTop + transcript.clientHeight
      ) {
        transcript.scrollTo({
          top: Math.max(0, top - transcript.clientHeight / 3),
          behavior: 'smooth',
        });
      }
    }),
  );

  // ---- control ---------------------------------------------------------------------------
  const seekTo = (ms: number): void => {
    const target = Math.max(0, Math.min(durationMs() || Number.MAX_SAFE_INTEGER, ms));
    if (audio) audio.currentTime = target / 1000;
    setCurrentMs(target);
  };
  const toggle = (): void => {
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };
  const cycleSpeed = (): void => {
    const next =
      SPEEDS[(SPEEDS.indexOf(speed() as (typeof SPEEDS)[number]) + 1) % SPEEDS.length] ?? 1;
    setSpeed(next);
    if (audio) audio.playbackRate = next;
  };
  const msAt = (event: PointerEvent): number => {
    const box = canvas?.getBoundingClientRect();
    if (!box || box.width <= 0) return 0;
    return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * durationMs();
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (durationMs() <= 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setScrubMs(msAt(event));
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (scrubMs() !== null) setScrubMs(msAt(event));
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (scrubMs() === null) return;
    seekTo(msAt(event));
    setScrubMs(null);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? 15_000 : 5_000;
    if (event.key === 'ArrowLeft') seekTo(currentMs() - step);
    else if (event.key === 'ArrowRight') seekTo(currentMs() + step);
    else if (event.key === 'Home') seekTo(0);
    else if (event.key === 'End') seekTo(durationMs());
    else if (event.key === ' ' || event.key === 'Enter') toggle();
    else return;
    event.preventDefault();
  };

  return (
    <div class={`audio-player${props.class ? ` ${props.class}` : ''}`}>
      <div class="audio-player__deck">
        <button
          type="button"
          class="audio-player__play"
          classList={{ 'audio-player__play--playing': playing() }}
          aria-label={playing() ? 'Пауза' : 'Слушать'}
          title={playing() ? 'Пауза' : 'Слушать'}
          onClick={toggle}
        >
          <AppGlyph name={playing() ? 'pause-fill' : 'play-fill'} class="audio-player__play-icon" />
        </button>
        <div class="audio-player__track">
          <canvas
            ref={(element) => {
              canvas = element;
            }}
            class="audio-player__wave"
            role="slider"
            tabindex="0"
            aria-label={`Позиция: ${props.label}`}
            aria-valuemin={0}
            aria-valuemax={Math.round(durationMs() / 1000)}
            aria-valuenow={Math.round(shownMs() / 1000)}
            aria-valuetext={`${formatRecordingDuration(shownMs())} из ${formatRecordingDuration(durationMs())}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setScrubMs(null)}
            onKeyDown={onKeyDown}
          />
          <div class="audio-player__times">
            <span class="audio-player__time">{formatRecordingDuration(shownMs())}</span>
            <span class="audio-player__time audio-player__time--total">
              {formatRecordingDuration(durationMs())}
            </span>
          </div>
        </div>
      </div>
      <div class="audio-player__tools">
        <button
          type="button"
          class="audio-player__tool"
          aria-label={`Назад на ${SKIP_SECONDS} секунд`}
          title={`−${SKIP_SECONDS} с`}
          onClick={() => seekTo(currentMs() - SKIP_SECONDS * 1000)}
        >
          <AppGlyph name="arrow-counter-clockwise" class="audio-player__tool-icon" />
          <span class="audio-player__tool-label">{SKIP_SECONDS}</span>
        </button>
        <button
          type="button"
          class="audio-player__tool audio-player__tool--speed"
          aria-label={`Скорость ${speedLabel(speed())}`}
          title="Скорость"
          onClick={cycleSpeed}
        >
          {speedLabel(speed())}
        </button>
        <button
          type="button"
          class="audio-player__tool"
          aria-label={`Вперёд на ${SKIP_SECONDS} секунд`}
          title={`+${SKIP_SECONDS} с`}
          onClick={() => seekTo(currentMs() + SKIP_SECONDS * 1000)}
        >
          <AppGlyph name="arrow-clockwise" class="audio-player__tool-icon" />
          <span class="audio-player__tool-label">{SKIP_SECONDS}</span>
        </button>
      </div>
      <Show when={(props.segments ?? []).length > 0}>
        <ol
          ref={(element) => {
            transcript = element;
          }}
          class="audio-player__transcript"
          aria-label="Текст беседы"
        >
          <For each={props.segments}>
            {(segment, index) => (
              <li
                class="audio-player__segment"
                classList={{ 'audio-player__segment--active': index() === activeIndex() }}
                aria-current={index() === activeIndex() ? 'true' : undefined}
              >
                <Show
                  when={segment.startMs !== undefined}
                  fallback={<span class="audio-player__segment-text">{segment.text}</span>}
                >
                  <button
                    type="button"
                    class="audio-player__segment-button"
                    onClick={() => {
                      seekTo(segment.startMs ?? 0);
                      if (audio?.paused) toggle();
                    }}
                  >
                    <span class="audio-player__segment-time">
                      {formatRecordingDuration(segment.startMs ?? 0)}
                    </span>
                    <span class="audio-player__segment-text">{segment.text}</span>
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ol>
      </Show>
      {/* biome-ignore lint/a11y/useMediaCaption: the transcript above is the recording's text. */}
      <audio
        ref={(element) => {
          audio = element;
        }}
        class="audio-player__media"
        src={props.src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          if (audio) setCurrentMs(audio.currentTime * 1000);
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrentMs(0);
          if (audio) audio.currentTime = 0;
        }}
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;
          element.playbackRate = speed();
          if (Number.isFinite(element.duration)) setMediaMs(element.duration * 1000);
          // A MediaRecorder file has no length in its header; reading it once makes seeking exact.
          else resolveRecordedDuration(element);
        }}
        onDurationChange={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value)) setMediaMs(value * 1000);
        }}
      />
    </div>
  );
}
