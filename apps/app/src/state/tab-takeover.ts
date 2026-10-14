/**
 * One tab at a time owns the local database (an OPFS pool is held by one worker and one Web Lock;
 * AGENTS.md «An OPFS pool has one worker owner»). A second tab used to wait for ever with nothing
 * to press. Now it can ask the owner to let go:
 *
 * - the waiting tab posts `takeover` on a BroadcastChannel («Использовать здесь»);
 * - the owner marks itself *standby* in its session storage and reloads. The reload tears down
 *   every worker it had, so every pool lock is released before the other tab opens the pool; the
 *   standby page opens nothing (no core, no modules) and offers the same button the other way;
 * - a standby tab that takes over clears the mark, asks the current owner to let go, and reloads.
 *
 * A tab that is itself waiting for the lock never yields to a request.
 */
const CHANNEL_NAME = 'minimed-tab-takeover';
const STANDBY_KEY = 'minimed:standby-tab';

interface TakeoverMessage {
  readonly type: 'takeover';
  readonly from: string;
}

const tabId =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

function openChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME);
}

function isTakeoverMessage(value: unknown): value is TakeoverMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'takeover' &&
    typeof (value as { from?: unknown }).from === 'string'
  );
}

/** This tab was told to let go and reloaded into standby: it opens no database. */
export function isStandbyTab(): boolean {
  try {
    return window.sessionStorage.getItem(STANDBY_KEY) === '1';
  } catch {
    return false;
  }
}

function setStandby(on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(STANDBY_KEY, '1');
    else window.sessionStorage.removeItem(STANDBY_KEY);
  } catch {
    // Without session storage the tab cannot stay in standby across the reload; it just reloads.
  }
}

/** Asks every other tab that owns the database to let go of it. */
export function requestTakeover(): void {
  const channel = openChannel();
  if (!channel) return;
  channel.postMessage({ type: 'takeover', from: tabId } satisfies TakeoverMessage);
  channel.close();
}

/** A standby tab becomes the owner: the current owner is asked to yield, then this tab reloads. */
export function resumeFromStandby(): void {
  setStandby(false);
  requestTakeover();
  window.location.reload();
}

/**
 * Listens for takeover requests. The tab yields (standby + reload) unless it is itself waiting for
 * the database. Returns the function that stops listening.
 */
export function installTakeoverListener(options: {
  readonly isWaiting: () => boolean;
  readonly reload?: () => void;
}): () => void {
  const channel = openChannel();
  if (!channel) return () => undefined;
  channel.onmessage = (event: MessageEvent<unknown>): void => {
    const message = event.data;
    if (!isTakeoverMessage(message) || message.from === tabId) return;
    if (options.isWaiting() || isStandbyTab()) return;
    setStandby(true);
    (options.reload ?? (() => window.location.reload()))();
  };
  return () => channel.close();
}
