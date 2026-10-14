/**
 * History layers: the one mechanism by which things that sit over a page (dialogs and sheets, the
 * «?» help panel, an inline link preview, the section menu) take part in the history.
 *
 * Opening a layer pushes an entry at the same address, stamped as a layer. Then
 *
 * - the system back, the browser back and Android back all peel exactly that layer: the arrival
 *   one level down dismisses it (`onPop`), and nothing else happens;
 * - closing it from the UI (`pop`) is a history step back, so UI and history never disagree;
 * - leaving it by navigating forward (a link in a sheet, a section chosen in a menu) dismisses it
 *   too, but the entry stays below the new page as a *dead* layer; when the history comes back to
 *   a dead layer it steps over it in the direction it was going, so one press of back still lands
 *   on the page that lay under the layer, never on a phantom copy of it.
 *
 * Escape and taps outside stay with the component: they call `pop` (or just close the component,
 * whose cleanup calls `dispose`).
 */
import {
  currentHistoryEntry,
  type HistoryEntryInfo,
  onHistoryArrival,
  pushStampedEntry,
} from '@/state/history-entries';

export interface HistoryLayerOptions {
  /** The history left the layer (back, forward, a navigation): the component closes itself. */
  readonly onPop: () => void;
}

export interface HistoryLayer {
  /** Closes the layer from the UI by stepping the history back; the arrival calls `onPop`. */
  pop(): void;
  /** The component went away by itself: forget the layer, and take its entry off if it is on top. */
  dispose(): void;
}

interface LiveLayer {
  readonly id: string;
  readonly onPop: () => void;
}

const live: LiveLayer[] = [];
let listening: (() => void) | undefined;
/** A history step this module started and whose arrival has not been seen yet. */
let pendingStep: Promise<void> | undefined;

function ensureListening(): void {
  listening ??= onHistoryArrival(handleArrival);
}

function handleArrival(entry: HistoryEntryInfo, previous: HistoryEntryInfo | null): void {
  // A hash traversal raises popstate and hashchange: the second look at the same arrival is noise.
  if (previous?.id === entry.id) return;
  const index = live.findIndex((layer) => layer.id === entry.id);
  // Everything above the entry the page is on is gone: popped by a step back, or left behind by a
  // navigation to another page.
  const dismissed = live.splice(index + 1);
  for (const layer of dismissed.reverse()) layer.onPop();
  if (entry.layer && index === -1) {
    // A layer entry nobody shows any more: step over it, the way the history was going.
    if (previous && previous.depth > entry.depth) window.history.back();
    else window.history.forward();
  }
}

/**
 * A layer whose component has closed and whose entry is still to be taken off (one task later, so
 * that *close, then navigate* is not a race).
 */
interface PendingPop {
  readonly layerId: string;
  done: boolean;
}
const pendingPops: PendingPop[] = [];

/** How many closed layers still sit on top of the page the history is on. */
export function pendingLayerPops(): number {
  const id = currentHistoryEntry().id;
  return pendingPops.filter((pop) => !pop.done && pop.layerId === id).length;
}

/** Takes over the pending pops: the caller's own history step covers them. Returns how many. */
function consumePendingLayerPops(): number {
  const id = currentHistoryEntry().id;
  let consumed = 0;
  for (const pop of pendingPops) {
    if (!pop.done && pop.layerId === id) {
      pop.done = true;
      consumed += 1;
    }
  }
  return consumed;
}

function stepBack(steps = 1): void {
  const settled = new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (): void => {
      window.removeEventListener('popstate', done);
      if (timer !== undefined) clearTimeout(timer);
      if (pendingStep === settled) pendingStep = undefined;
      resolve();
    };
    window.addEventListener('popstate', done);
    // The step may never arrive (nothing below): do not hold later layers back for ever.
    timer = setTimeout(done, 300);
  });
  pendingStep = settled;
  if (steps === 1) window.history.back();
  else window.history.go(-steps);
}

/**
 * Steps the history back by one entry *of the page*: layers that have just closed (and whose entry
 * is not off yet) are stepped over in the same traversal, so *close a dialog, then go back* is two
 * entries in one step. A second request while the first step is on its way (a double tap on ‹) is
 * ignored: it would take the page two levels up.
 */
export function stepHistoryBackOnce(): void {
  if (pendingStep) return;
  stepBack(1 + consumePendingLayerPops());
}

/**
 * Steps the history by `steps` (negative) entries counted from the entry the page is on now, as
 * `stepsBackToPlace` measures them. Closed layers waiting to be taken off are covered by the step.
 */
export function goBackToPlace(steps: number): void {
  consumePendingLayerPops();
  window.history.go(steps);
}

/**
 * Runs `run` once no layer is left on top of the page: the closed layers' entries are off and the
 * traversal that took them has arrived. For a choice made in a sheet that changes the page's own
 * address (the section menu): it must act on the page's entry, not on the closed layer's.
 */
export function afterLayersClosed(run: () => void): void {
  const started = Date.now();
  const check = (): void => {
    const settling = pendingPops.some((pop) => !pop.done) || pendingStep !== undefined;
    if (!settling || Date.now() - started > 500) {
      run();
      return;
    }
    setTimeout(check, 16);
  };
  // The pops are scheduled one task later than the close that precedes this call.
  setTimeout(check, 0);
}

/** Whether a layer is open over the page. */
export function hasHistoryLayer(): boolean {
  return live.length > 0;
}

/**
 * Closes the topmost layer as the back button does. Returns false when no layer is open (the
 * caller then handles the back press itself).
 */
export function popTopHistoryLayer(): boolean {
  const top = live[live.length - 1];
  if (!top) return false;
  if (currentHistoryEntry().id === top.id) {
    stepBack();
  } else {
    // The page moved on without the layer noticing: close it directly.
    live.pop();
    top.onPop();
  }
  return true;
}

export function openHistoryLayer(options: HistoryLayerOptions): HistoryLayer {
  ensureListening();
  let layerId: string | undefined;
  let disposed = false;

  const open = (): void => {
    if (disposed) return;
    const entry = pushStampedEntry(null, true);
    layerId = entry.id;
    live.push({ id: entry.id, onPop: options.onPop });
  };
  // A step back that is still on its way would take this push with it.
  if (pendingStep) void pendingStep.then(open);
  else open();

  const forget = (): LiveLayer | undefined => {
    if (layerId === undefined) return undefined;
    const index = live.findIndex((layer) => layer.id === layerId);
    return index >= 0 ? live.splice(index, 1)[0] : undefined;
  };

  return {
    pop(): void {
      if (layerId === undefined) {
        // Not pushed yet: the component closes before the layer exists.
        disposed = true;
        options.onPop();
        return;
      }
      if (live.some((layer) => layer.id === layerId) && currentHistoryEntry().id === layerId) {
        stepBack();
        // The arrival closes the component. Should it never come, close it anyway.
        setTimeout(() => {
          if (forget()) options.onPop();
        }, 500);
        return;
      }
      forget();
      options.onPop();
    },
    dispose(): void {
      disposed = true;
      const layer = forget();
      // Dismissed by the history or by a navigation already: nothing to take off.
      if (!layer) return;
      // A component that closes and then navigates (a link in a sheet, «Открыть» in a preview) is
      // not racing the step back: by the time this runs the new page is on top of the layer's
      // entry, which stays below it as a dead layer, and nothing is stepped back.
      const pending: PendingPop = { layerId: layer.id, done: false };
      pendingPops.push(pending);
      setTimeout(() => {
        pendingPops.splice(pendingPops.indexOf(pending), 1);
        if (pending.done) return;
        if (currentHistoryEntry().id === layer.id) stepBack();
      }, 0);
    },
  };
}

/** For tests: forgets every layer and the listener. */
export function resetHistoryLayersForTests(): void {
  live.length = 0;
  pendingPops.length = 0;
  listening?.();
  listening = undefined;
  pendingStep = undefined;
}
