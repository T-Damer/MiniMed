/**
 * The boot surface: `#boot-surface` in index.html repeats the Android splash (same ground, same
 * wallet at the same size and place). The native splash waits for {@link revealFromBootSurface},
 * fades onto that identical picture, and then the page's own surface plays the visible exit over
 * an already rendered first screen. In a browser the same exit runs without the native step.
 */
import { motionMs } from '@/state/motion';
import { reportNativeBootReady } from '@/state/native-system-ui';

/** MainActivity.SPLASH_EXIT_MS plus a frame: the native fade finishes before ours begins. */
const NATIVE_SPLASH_EXIT_MS = 200;
/** Upper bound for the exit animation at normal speed, in case it never reports finishing. */
const EXIT_FALLBACK_MS = 600;
/** The first screen's code and fonts get this long; after it the surface leaves regardless. */
export const FIRST_SCREEN_WAIT_MS = 1500;

let revealed = false;
let markRevealed: () => void = () => undefined;
const revealedPromise = new Promise<void>((resolve) => {
  markRevealed = resolve;
});

/**
 * Resolves once the boot surface has gone. Heavy start-up work that is not on the first screen
 * (the full module catalog, for one) waits for this so it never stalls the reveal animation.
 */
export function afterBootReveal(): Promise<void> {
  if (!document.getElementById('boot-surface')) return Promise.resolve();
  return revealedPromise;
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

/** Resolves once `work` settles (or the wait runs out) and two frames have been painted. */
export async function firstScreenPainted(work: readonly Promise<unknown>[]): Promise<void> {
  await Promise.race([Promise.allSettled(work), delay(FIRST_SCREEN_WAIT_MS)]);
  await nextFrame();
  await nextFrame();
}

export async function revealFromBootSurface(): Promise<void> {
  if (revealed) return;
  revealed = true;
  performance.mark('minimed:boot-reveal');
  try {
    await leaveBootSurface();
  } finally {
    markRevealed();
  }
}

async function leaveBootSurface(): Promise<void> {
  const surface = document.getElementById('boot-surface');
  // Floating windows load the app in a frame: no native splash there, and no surface to keep.
  const topLevel = window.top === window;
  if (topLevel && reportNativeBootReady()) await delay(motionMs(NATIVE_SPLASH_EXIT_MS));
  if (!surface) return;
  const icon = surface.querySelector<HTMLElement>('.boot-surface__icon');
  if (
    !topLevel ||
    motionMs(1) === 0 ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    surface.remove();
    return;
  }
  await new Promise<void>((resolve) => {
    const done = (): void => {
      window.clearTimeout(fallback);
      resolve();
    };
    const fallback = window.setTimeout(
      done,
      Math.max(EXIT_FALLBACK_MS, motionMs(EXIT_FALLBACK_MS)),
    );
    surface.addEventListener('animationend', (event) => {
      if (event.target === surface) done();
    });
    surface.classList.add('boot-surface--leaving');
    icon?.classList.add('boot-surface__icon--leaving');
  });
  surface.remove();
}
