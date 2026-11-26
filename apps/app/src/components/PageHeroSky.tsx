import { type JSX, onCleanup, onMount } from 'solid-js';
import { createSkyRenderer } from '@/components/page-hero-sky';
import { motionMs } from '@/state/motion';
import '@/components/PageHeroSky.css';

const DRIFT_MS = 2300;
const FRAME_MS = 32;
const MAX_WIDTH = 480;
const MAX_HEIGHT = 160;

/** A short drift when the band enters view, then a still sky with no animation work. */
export function PageHeroSky(): JSX.Element {
  let canvas!: HTMLCanvasElement;

  onMount(() => {
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let renderer: ReturnType<typeof createSkyRenderer> | undefined;
    let visible = typeof IntersectionObserver === 'undefined';
    let lost = false;
    let frame: number | undefined;
    let startedAt: number | undefined;
    let lastDraw = -Infinity;
    let finished = false;
    let width = 0;
    let height = 0;

    const schedule = () => {
      const canDraw = visible && !document.hidden && !lost && renderer !== null && width > 0;
      if (canDraw && frame === undefined) frame = requestAnimationFrame(draw);
      if (!canDraw && frame !== undefined) {
        cancelAnimationFrame(frame);
        frame = undefined;
      }
    };

    const draw = (now: number) => {
      frame = undefined;
      if (renderer === undefined) renderer = createSkyRenderer(canvas);
      if (!renderer) return;
      startedAt ??= now;
      const duration = reducedMotion.matches ? 0 : motionMs(DRIFT_MS);
      const progress = finished || !duration ? 1 : Math.min(1, (now - startedAt) / duration);
      if (progress === 1 || now - lastDraw >= FRAME_MS) {
        const easeOut = 1 - (1 - progress) ** 2;
        renderer.draw(width, height, easeOut);
        if (lastDraw === -Infinity) canvas.classList.add('page-hero-sky--ready');
        lastDraw = now;
      }
      finished = progress === 1;
      if (!finished) schedule();
    };

    const measure = (rect: DOMRectReadOnly) => {
      const scale = Math.min(0.85, MAX_WIDTH / rect.width, MAX_HEIGHT / rect.height);
      width = rect.width > 0 && rect.height > 0 ? Math.max(1, Math.round(rect.width * scale)) : 0;
      height = Math.max(1, Math.round(rect.height * scale));
      schedule();
    };
    const resize = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect);
    });
    resize.observe(canvas);

    const intersection =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? false;
            schedule();
          });
    intersection?.observe(canvas);

    const contextLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      renderer = undefined;
      lastDraw = -Infinity;
      canvas.classList.remove('page-hero-sky--ready');
      schedule();
    };
    const contextRestored = () => {
      lost = false;
      schedule();
    };
    canvas.addEventListener('webglcontextlost', contextLost);
    canvas.addEventListener('webglcontextrestored', contextRestored);
    document.addEventListener('visibilitychange', schedule);
    onCleanup(() => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      resize.disconnect();
      intersection?.disconnect();
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      document.removeEventListener('visibilitychange', schedule);
      renderer?.dispose();
    });
  });

  return <canvas ref={canvas} class="page-hero-sky" />;
}
