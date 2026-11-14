import { type JSX, onCleanup, onMount } from 'solid-js';

import { peakHeight } from '@/features/conversations/recording-audio';
import { perfCount, perfLogOn } from '@/state/perf-log';

/** The recorder's peaks arrive 20 times a second; drawing faster would repeat frames. */
const FRAME_MS = 50;

export interface PeakSource {
  recentPeaks(target: Float32Array): number;
  paused(): boolean;
}

/**
 * The voice as it is heard (REC1): the last seconds of the recorder's peaks as bars, newest at the
 * right edge, on a canvas — no DOM element changes per frame, so nothing is restyled or laid out.
 * It draws only while it is on screen and the page is visible, at most 20 times a second, and
 * stops on a pause (the bars stay where they were). Its colour is the canvas's CSS `color`.
 */
export function LiveWaveform(props: {
  readonly source: () => PeakSource | null;
  readonly class: string;
  /** Bar width and gap in CSS pixels. */
  readonly bar?: number;
  readonly gap?: number;
}): JSX.Element {
  let canvas: HTMLCanvasElement | undefined;
  onMount(() => {
    const element = canvas;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const bar = props.bar ?? 2;
    const gap = props.gap ?? 2;
    let width = 0;
    let height = 0;
    let scale = 1;
    let peaks = new Float32Array(0);
    let color = '';
    let frame = 0;
    let last = 0;
    let visible = true;
    let colorCheckedAt = 0;

    const resize = (): void => {
      const box = element.getBoundingClientRect();
      scale = Math.min(3, window.devicePixelRatio || 1);
      width = Math.max(1, Math.round(box.width));
      height = Math.max(1, Math.round(box.height));
      element.width = Math.round(width * scale);
      element.height = Math.round(height * scale);
      peaks = new Float32Array(Math.max(1, Math.floor((width + gap) / (bar + gap))));
    };

    const draw = (): void => {
      const source = props.source();
      const count = source ? source.recentPeaks(peaks) : 0;
      const now = performance.now();
      if (now - colorCheckedAt > 2_000 || !color) {
        color = getComputedStyle(element).color;
        colorCheckedAt = now;
      }
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = color;
      const slots = peaks.length;
      for (let slot = 0; slot < slots; slot += 1) {
        // Right-aligned: the newest peak at the right edge, older ones to its left.
        const index = slot - (slots - count);
        const value = index >= 0 ? (peaks[index] ?? 0) : 0;
        const barHeight = Math.max(2, peakHeight(value) * height);
        const x = slot * (bar + gap);
        const y = (height - barHeight) / 2;
        context.beginPath();
        context.roundRect(x, y, bar, barHeight, bar / 2);
        context.fill();
      }
    };

    const tick = (now: number): void => {
      frame = 0;
      if (!visible) return;
      perfCount('waveform.frame');
      if (now - last >= FRAME_MS) {
        last = now;
        if (perfLogOn()) {
          const started = performance.now();
          draw();
          perfCount('waveform.draw', performance.now() - started);
        } else {
          draw();
        }
      }
      if (!props.source()?.paused()) frame = requestAnimationFrame(tick);
    };
    const start = (): void => {
      if (frame === 0 && visible) frame = requestAnimationFrame(tick);
    };

    const sizes = new ResizeObserver(() => {
      resize();
      draw();
    });
    sizes.observe(element);
    const seen = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) start();
    });
    seen.observe(element);
    // A resumed recording starts the loop again; the poll is a cheap check, not a draw.
    const resumeCheck = window.setInterval(() => {
      if (!props.source()?.paused()) start();
    }, 250);
    resize();
    draw();
    start();
    onCleanup(() => {
      cancelAnimationFrame(frame);
      window.clearInterval(resumeCheck);
      sizes.disconnect();
      seen.disconnect();
    });
  });
  return (
    <canvas
      ref={(element) => {
        canvas = element;
      }}
      class={props.class}
    />
  );
}
