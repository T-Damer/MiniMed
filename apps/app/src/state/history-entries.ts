/**
 * What the app knows about the browser history entry it is on.
 *
 * Every entry the app visits is stamped, in `history.state`, with an id and its depth: the number of
 * app entries below it that this page load has seen. The reader uses two facts from that:
 *
 * - **Is there an in-app entry to go back to?** The reader's own «Назад» must then be the browser's
 *   back (`history.back()`), not a second push of the address it came from — a push makes the history
 *   grow with every back press and sends a later system back to the document just left. A deep link,
 *   a reload of an old build's entry or an entry the app cannot classify has depth 0, and the reader
 *   navigates to its origin by replacing the entry instead.
 * - **Where was the reader on this entry?** The reading position (the section under the reading line
 *   and the pixels past its start) is saved on the entry itself, so back and forward — and a reload —
 *   return to the same place. Sections mount lazily and their heights are estimated, so a scroll
 *   offset would not survive; an anchor plus an offset inside it does.
 *
 * A push is told from a traversal without the Navigation API: a push raises `history.length` and
 * arrives unstamped; a traversal lands on an entry that is already stamped. An unstamped arrival
 * without a longer history (an entry whose state other code replaced, or the history cap) is
 * treated as "unknown" and gets depth 0, which only ever makes the reader navigate by replacing.
 */

const ENTRY_KEY = 'minimedEntry';

export interface ReaderPosition {
  /** Id of the section element under the reading line. */
  readonly anchor: string;
  /** Pixels the reading line had passed the section's aligned start (negative: above it). */
  readonly offset: number;
}

export interface HistoryEntryInfo {
  readonly id: string;
  /** Number of app entries below this one; 0 when none is known. */
  readonly depth: number;
  readonly position?: ReaderPosition;
  /**
   * The entry was pushed for a layer (sheet, dialog, preview) that sits over the page at the same
   * address (`history-layer.ts`). Once the layer is gone the entry is a dead one and is stepped
   * over when the history reaches it.
   */
  readonly layer?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePosition(value: unknown): ReaderPosition | undefined {
  if (!isRecord(value)) return undefined;
  const { anchor, offset } = value;
  if (typeof anchor !== 'string' || anchor === '') return undefined;
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return undefined;
  return { anchor, offset };
}

/** The stamp inside a `history.state` value, or `null` when the entry has none. */
export function readHistoryEntry(state: unknown): HistoryEntryInfo | null {
  if (!isRecord(state)) return null;
  const raw = state[ENTRY_KEY];
  if (!isRecord(raw)) return null;
  const { id, depth } = raw;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0) return null;
  const position = parsePosition(raw['position']);
  return {
    id,
    depth,
    ...(position ? { position } : {}),
    ...(raw['layer'] === true ? { layer: true } : {}),
  };
}

/** The `history.state` value with the stamp replaced; other keys of the state are kept. */
export function withHistoryEntry(state: unknown, entry: HistoryEntryInfo): Record<string, unknown> {
  return { ...(isRecord(state) ? state : {}), [ENTRY_KEY]: entry };
}

export type NavigationKind = 'push' | 'replace' | 'traverse' | 'reload';

export interface HistoryObservation {
  readonly state: unknown;
  readonly length: number;
  /** The entry the app was on before this observation, if it has seen one. */
  readonly previous: HistoryEntryInfo | null;
  /** `history.length` at the previous observation. */
  readonly previousLength: number;
  /**
   * What the Navigation API reported since the previous observation, when the browser has it: the
   * only way to tell a push that cut off forward entries (the length does not change) from an
   * entry whose state was replaced.
   */
  readonly navigation?: ReadonlySet<NavigationKind>;
}

/** The entry to stamp on an unstamped arrival; `null` when the state already carries a stamp. */
export function classifyArrival(observation: HistoryObservation): HistoryEntryInfo | null {
  if (readHistoryEntry(observation.state)) return null;
  const { previous, navigation } = observation;
  let pushed: boolean;
  if (navigation && navigation.size > 0 && previous !== null) {
    if (navigation.has('push')) pushed = true;
    else if (navigation.has('replace')) {
      // The same entry with its state replaced: it keeps its place.
      return { id: newEntryId(), depth: previous.depth };
    } else pushed = false;
  } else {
    pushed = observation.length > observation.previousLength && previous !== null;
  }
  return {
    id: newEntryId(),
    depth: pushed && previous ? previous.depth + 1 : 0,
  };
}

let counter = 0;
function newEntryId(): string {
  counter += 1;
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${random}-${String(counter)}`;
}

let lastEntry: HistoryEntryInfo | null = null;
let lastLength = 0;
/** What the Navigation API said happened since the last observation (empty without the API). */
let seenNavigations: Set<NavigationKind> = new Set();

interface NavigateEventLike extends Event {
  readonly navigationType?: string;
}
interface NavigationLike {
  addEventListener(type: 'navigate', listener: (event: NavigateEventLike) => void): void;
  removeEventListener(type: 'navigate', listener: (event: NavigateEventLike) => void): void;
}

function navigationApi(): NavigationLike | null {
  const candidate = (window as unknown as { navigation?: NavigationLike }).navigation;
  return candidate && typeof candidate.addEventListener === 'function' ? candidate : null;
}

/**
 * Where the entries of the current branch point: `places[depth]` is the address (search and hash)
 * of the entry at that depth. It lets the app step back to a place it has already been in, rather
 * than stack the same address again. Entries above the current one are forward entries and may be
 * stale; only the ones below it are read.
 */
const places: string[] = [];

/** The address a tab opens on (no hash at all) is the search page. */
const HOME_HASH = '#/search';

function currentPlace(): string {
  return placeOf(window.location.hash, window.location.search);
}

function recordPlace(entry: HistoryEntryInfo, restart: 'none' | 'branch' | 'all'): void {
  if (restart === 'all') places.length = 0;
  else if (restart === 'branch') places.length = entry.depth;
  places[entry.depth] = currentPlace();
}

/**
 * Looks at the entry the page is on now and stamps it if the app has not. Safe to call any number of
 * times (every navigation event, and before every read): a stamped entry is only remembered.
 */
export function observeHistoryEntry(): HistoryEntryInfo {
  const state: unknown = window.history.state;
  const stamp = classifyArrival({
    state,
    length: window.history.length,
    previous: lastEntry,
    previousLength: lastLength,
    navigation: seenNavigations,
  });
  seenNavigations = new Set();
  const entry = stamp ?? (readHistoryEntry(state) as HistoryEntryInfo);
  if (stamp) window.history.replaceState(withHistoryEntry(state, stamp), '');
  // A stamped arrival is a traversal and only refreshes its own place; a push drops the entries
  // above it from the branch; an unknown arrival starts the branch over.
  recordPlace(entry, stamp ? (stamp.depth === 0 ? 'all' : 'branch') : 'none');
  lastEntry = entry;
  lastLength = window.history.length;
  return entry;
}

/**
 * Pushes an entry at the current address that the app itself stamps (a layer over the page): one
 * level deeper than the entry it covers. Returns its stamp.
 */
export function pushStampedEntry(state: unknown, layer: boolean): HistoryEntryInfo {
  const below = observeHistoryEntry();
  const entry: HistoryEntryInfo = {
    id: newEntryId(),
    depth: below.depth + 1,
    ...(layer ? { layer: true } : {}),
    // A layer covers the page: it carries the reading place of the page under it (a reload on the
    // layer brings the page back at that place), and none of the page's other state — the
    // page's own code must not mistake the layer for its entry.
    ...(layer && below.position ? { position: below.position } : {}),
  };
  window.history.pushState(withHistoryEntry(layer ? null : state, entry), '', window.location.href);
  // This push is stamped here: the Navigation API's note of it must not colour a later arrival.
  seenNavigations = new Set();
  recordPlace(entry, 'branch');
  lastEntry = entry;
  lastLength = window.history.length;
  return entry;
}

/**
 * How many entries back an earlier visit to this address lies on the current branch (`-1` is the
 * entry below), or `null` when it was not visited in this page load.
 */
export function stepsBackToPlace(place: string): number | null {
  const entry = currentHistoryEntry();
  for (let depth = entry.depth - 1; depth >= 0; depth -= 1) {
    if (places[depth] === place) return depth - entry.depth;
  }
  return null;
}

/** The address of the entry the page is on, in the form {@link stepsBackToPlace} compares. */
export function placeOf(hash: string, search = ''): string {
  return `${search}${hash === '' ? HOME_HASH : hash}`;
}

type ArrivalListener = (entry: HistoryEntryInfo, previous: HistoryEntryInfo | null) => void;
const arrivalListeners = new Set<ArrivalListener>();

/** Called for every arrival the tracker sees (back, forward, hash change, after the stamp). */
export function onHistoryArrival(listener: ArrivalListener): () => void {
  arrivalListeners.add(listener);
  return () => {
    arrivalListeners.delete(listener);
  };
}

/** The stamp of the entry the page is on. */
export function currentHistoryEntry(): HistoryEntryInfo {
  return observeHistoryEntry();
}

/** Whether an entry of this app lies below the current one, so `history.back()` stays in the app. */
export function hasInAppPreviousEntry(): boolean {
  return currentHistoryEntry().depth > 0;
}

/**
 * Saves the reading position on the entry with this id. Returns false when the page has moved on to
 * another entry (a late write must never land on the document that replaced the reader).
 */
export function saveReaderPosition(entryId: string, position: ReaderPosition): boolean {
  const entry = observeHistoryEntry();
  if (entry.id !== entryId) return false;
  const current = readHistoryEntry(window.history.state);
  if (
    current?.position?.anchor === position.anchor &&
    current.position.offset === position.offset
  ) {
    return true;
  }
  window.history.replaceState(withHistoryEntry(window.history.state, { ...entry, position }), '');
  return true;
}

type PositionFlusher = () => void;
const flushers = new Set<PositionFlusher>();

/** A reader registers how to write its current position; the app calls it before leaving. */
export function registerReaderPositionFlusher(flush: PositionFlusher): () => void {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

/** Writes the position of every registered reader (the page is about to navigate or hide). */
export function flushReaderPositions(): void {
  for (const flush of flushers) flush();
}

/**
 * Starts following the history: stamps every entry the app arrives on, and writes the reading
 * position out before a tap can navigate (capture phase, so ahead of any link handler) and when the
 * page hides. Returns the function that stops it.
 */
export function installHistoryEntryTracking(): () => void {
  const first = observeHistoryEntry();
  // A reload on an entry that was a layer: the layer is gone, the entry is a page now.
  if (first.layer) {
    const { layer: _layer, ...page } = first;
    window.history.replaceState(withHistoryEntry(window.history.state, page), '');
    lastEntry = page;
  }
  const observe = (): void => {
    const previous = lastEntry;
    const entry = observeHistoryEntry();
    for (const listener of arrivalListeners) listener(entry, previous);
  };
  const flushOnHide = (): void => {
    if (document.visibilityState === 'hidden') flushReaderPositions();
  };
  const noteNavigation = (event: NavigateEventLike): void => {
    const kind = event.navigationType;
    if (kind === 'push' || kind === 'replace' || kind === 'traverse' || kind === 'reload') {
      seenNavigations.add(kind);
    }
  };
  navigationApi()?.addEventListener('navigate', noteNavigation);
  window.addEventListener('hashchange', observe);
  window.addEventListener('popstate', observe);
  window.addEventListener('click', flushReaderPositions, true);
  window.addEventListener('keydown', flushReaderPositions, true);
  window.addEventListener('pagehide', flushReaderPositions);
  document.addEventListener('visibilitychange', flushOnHide);
  return () => {
    navigationApi()?.removeEventListener('navigate', noteNavigation);
    window.removeEventListener('hashchange', observe);
    window.removeEventListener('popstate', observe);
    window.removeEventListener('click', flushReaderPositions, true);
    window.removeEventListener('keydown', flushReaderPositions, true);
    window.removeEventListener('pagehide', flushReaderPositions);
    document.removeEventListener('visibilitychange', flushOnHide);
  };
}

/** For tests: forgets what the tracker remembered. */
export function resetHistoryEntryTrackingForTests(): void {
  lastEntry = null;
  lastLength = 0;
  seenNavigations = new Set();
  places.length = 0;
  flushers.clear();
  arrivalListeners.clear();
}
