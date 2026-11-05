/**
 * A tap that changes the route answers at once. Mounting the next page runs for a hundred
 * milliseconds on a phone and blocks the main thread, so a navigation made inside the tap's click
 * handler froze the screen before anything moved. Here the page on screen starts its exit first
 * (compositor animations keep running while the thread is busy), and the route changes two frames
 * later — once the exit has been handed to the compositor — with the arrival's own entry animation
 * (`scheduleEnter` in use-root-navigation.ts) following the mount.
 *
 * Only forward and in-app back controls go through here; the system back changes the route on its
 * own and gets the entry only.
 */
import {
  animatePageEnter,
  animatePageLeave,
  claimPageEnter,
  consumePageEnterClaim,
} from '@/app/page-enter';

/** If the frames do not come (a hidden tab), the navigation still happens. */
const FRAME_FALLBACK_MS = 120;
const ENTER_RETRY_FRAMES = 20;

let pending = false;

/**
 * Changes the route and starts the arrival's entry in the same task. A push changes the address and
 * mounts the page synchronously, so the entry can start before the first frame that draws it — a
 * start any later shows the whole page for a frame, then blanks it and grows it back. A step back
 * in the history arrives in a task of its own: the address listener (use-root-navigation.ts)
 * starts that entry, in the task that mounts, so the claim is released here.
 */
function commitWithEntry(commit: () => void): void {
  claimPageEnter();
  commit();
  if (consumePageEnterClaim()) {
    // Nothing heard the address change yet: the arrival is asynchronous and starts its own entry.
    return;
  }
  const view = (): Element | null => document.querySelector('.app-view.active');
  if (animatePageEnter(view())) return;
  // A page still mounting (a lazy chunk): tried again each frame, as the address listener does.
  let frames = 0;
  const retry = (): void => {
    frames += 1;
    if (!animatePageEnter(view()) && frames < ENTER_RETRY_FRAMES) requestAnimationFrame(retry);
  };
  requestAnimationFrame(retry);
}

/** Runs `commit` (the navigation) after the current page has started to leave. */
export function navigateWithMotion(commit: () => void): void {
  // A second tap while the first is on its way (a double tap on ‹) must not navigate twice.
  if (pending) return;
  const started = animatePageLeave(document.querySelector('.app-view.active'));
  if (!started) {
    commit();
    return;
  }
  pending = true;
  let done = false;
  const run = (): void => {
    if (done) return;
    done = true;
    window.clearTimeout(fallback);
    pending = false;
    commitWithEntry(commit);
  };
  const fallback = window.setTimeout(run, FRAME_FALLBACK_MS);
  requestAnimationFrame(() => requestAnimationFrame(run));
}
