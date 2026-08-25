import { createEffect, createSignal, For, type JSX, on, onCleanup } from 'solid-js';

const BAR_COUNT = 44;

let sharedContext: AudioContext | null = null;
function audioContext(): AudioContext {
  if (!sharedContext) sharedContext = new AudioContext();
  return sharedContext;
}

/**
 * Compact audio attachment player: decodes peaks once per source, draws them
 * as a waveform, and toggles play/pause from the whole strip.
 */
export function AudioWaveformPlayer(props: {
  readonly src: string;
  readonly label: string;
  readonly compact?: boolean;
}): JSX.Element {
  const [peaks, setPeaks] = createSignal<readonly number[]>([]);
  const [duration, setDuration] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [hoverFraction, setHoverFraction] = createSignal<number | null>(null);
  let audio: HTMLAudioElement | undefined;

  const durationLabel = (seconds: number): string => {
    const whole = Math.round(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  };

  createEffect(
    on(
      () => props.src,
      (src) => {
        setPeaks([]);
        setDuration(0);
        setProgress(0);
        setPlaying(false);
        let cancelled = false;
        void (async () => {
          try {
            const buffer = await fetch(src).then((response) => response.arrayBuffer());
            const decoded = await audioContext().decodeAudioData(buffer);
            if (cancelled) return;
            setDuration(decoded.duration);
            const channel = decoded.getChannelData(0);
            const bucket = Math.max(1, Math.floor(channel.length / BAR_COUNT));
            const next: number[] = [];
            for (let index = 0; index < BAR_COUNT; index += 1) {
              let peak = 0;
              for (
                let offset = index * bucket;
                offset < Math.min(channel.length, (index + 1) * bucket);
                offset += 16
              ) {
                peak = Math.max(peak, Math.abs(channel[offset] ?? 0));
              }
              next.push(Math.max(0.08, Math.min(1, peak * 1.6)));
            }
            setPeaks(next);
          } catch {
            if (!cancelled) setPeaks(Array.from({ length: BAR_COUNT }, () => 0.3));
          }
        })();
        onCleanup(() => {
          cancelled = true;
        });
      },
    ),
  );

  onCleanup(() => {
    audio?.pause();
  });

  const toggle = (): void => {
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const fractionFromEvent = (event: MouseEvent): number => {
    const strip = event.currentTarget;
    if (!(strip instanceof HTMLElement)) return 0;
    const rect = strip.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };

  const seek = (fraction: number): void => {
    if (!audio) return;
    const total = duration() || audio.duration || 0;
    if (total > 0) audio.currentTime = fraction * total;
    setProgress(fraction);
  };

  return (
    <span class={`audio-waveform${props.compact ? ' audio-waveform--compact' : ''}`}>
      <button
        type="button"
        class="audio-waveform__toggle"
        aria-label={playing() ? 'Пауза' : 'Воспроизвести'}
        title={props.label}
        onClick={() => toggle()}
      >
        {playing() ? '❚❚' : '▶'}
      </button>
      <audio
        ref={(element) => {
          audio = element;
          element.addEventListener('timeupdate', () => {
            const duration = element.duration || 0;
            setProgress(duration > 0 ? element.currentTime / duration : 0);
          });
          element.addEventListener('ended', () => {
            setPlaying(false);
            setProgress(0);
          });
        }}
        src={props.src}
        preload="metadata"
      >
        <track kind="captions" label="Без субтитров" />
      </audio>
      <button
        type="button"
        class="audio-waveform__strip"
        aria-hidden="true"
        tabIndex={-1}
        onPointerMove={(event) => setHoverFraction(fractionFromEvent(event))}
        onPointerLeave={() => setHoverFraction(null)}
        onClick={(event) => seek(fractionFromEvent(event))}
      >
        <For each={[...Array(BAR_COUNT).keys()]}>
          {(index) => {
            const position = index / BAR_COUNT;
            const hover = hoverFraction();
            return (
              <span
                class="audio-waveform__bar"
                classList={{
                  'audio-waveform__bar--active': position <= progress(),
                  'audio-waveform__bar--seek':
                    hover !== null && position > progress() && position <= hover,
                }}
                style={{
                  '--bar-height': `${Math.round((peaks()[index] ?? 0.3) * 100)}%`,
                }}
              />
            );
          }}
        </For>
      </button>
      <span class="audio-waveform__duration">{durationLabel(duration() || 0)}</span>
    </span>
  );
}
