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
  return { id, depth, ...(position ? { position } : {}) };
}

/** The `history.state` value with the stamp replaced; other keys of the state are kept. */
export function withHistoryEntry(state: unknown, entry: HistoryEntryInfo): Record<string, unknown> {
  return { ...(isRecord(state) ? state : {}), [ENTRY_KEY]: entry };
}

export interface HistoryObservation {
  readonly state: unknown;
  readonly length: number;
  /** The entry the app was on before this observation, if it has seen one. */
  readonly previous: HistoryEntryInfo | null;
  /** `history.length` at the previous observation. */
  readonly previousLength: number;
}

/** The entry to stamp on an unstamped arrival; `null` when the state already carries a stamp. */
export function classifyArrival(observation: HistoryObservation): HistoryEntryInfo | null {
  if (readHistoryEntry(observation.state)) return null;
  const pushed = observation.length > observation.previousLength && observation.previous !== null;
  return {
    id: newEntryId(),
    depth: pushed && observation.previous ? observation.previous.depth + 1 : 0,
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
  });
  const entry = stamp ?? (readHistoryEntry(state) as HistoryEntryInfo);
  if (stamp) window.history.replaceState(withHistoryEntry(state, stamp), '');
  lastEntry = entry;
  lastLength = window.history.length;
  return entry;
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
  observeHistoryEntry();
  const observe = (): void => {
    observeHistoryEntry();
  };
  const flushOnHide = (): void => {
    if (document.visibilityState === 'hidden') flushReaderPositions();
  };
  window.addEventListener('hashchange', observe);
  window.addEventListener('popstate', observe);
  window.addEventListener('click', flushReaderPositions, true);
  window.addEventListener('keydown', flushReaderPositions, true);
  window.addEventListener('pagehide', flushReaderPositions);
  document.addEventListener('visibilitychange', flushOnHide);
  return () => {
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
  flushers.clear();
}
