/**
 * What the diary page and its worker (`public/diary/sw.js`) share about reminders, in Cache
 * Storage because a worker cannot read `localStorage`. Layout, relative to the diary folder:
 *
 * - `reminders/notices/<diary>.json` — `{ diary, notices }`: the texts for the coming moments;
 * - `reminders/actions/<diary>/<n>.json` — one `ReminderAction` per «Принял», written by the
 *   worker and removed by the page once applied.
 *
 * The data never leaves the phone; the server knows only the moments.
 */
import type { ReminderAction, ReminderNotice } from '@/features/diary/diary-reminders';

const CACHE = 'minimed-diary-reminders';

function folder(): string {
  return new URL('./reminders/', document.baseURI).href;
}

async function open(): Promise<Cache | undefined> {
  // A private window or an old browser may have no Cache Storage; reminders then stay off.
  if (typeof caches === 'undefined') return undefined;
  return caches.open(CACHE);
}

export async function writeReminderNotices(
  diary: string,
  notices: readonly ReminderNotice[],
): Promise<void> {
  const cache = await open();
  if (!cache) return;
  const key = `${folder()}notices/${diary}.json`;
  if (!notices.length) {
    await cache.delete(key);
    return;
  }
  await cache.put(
    key,
    new Response(JSON.stringify({ diary, notices }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

/** The «Принял» presses of one diary not applied yet, with a function that forgets them. */
export async function pendingReminderActions(diary: string): Promise<{
  readonly actions: readonly ReminderAction[];
  readonly clear: () => Promise<void>;
}> {
  const cache = await open();
  if (!cache) return { actions: [], clear: async () => undefined };
  const prefix = `${folder()}actions/${diary}/`;
  const requests = (await cache.keys()).filter((request) => request.url.startsWith(prefix));
  const actions: ReminderAction[] = [];
  for (const request of requests) {
    const response = await cache.match(request);
    const value = (await response?.json()) as ReminderAction | undefined;
    if (value?.diary === diary && Array.isArray(value.doses)) actions.push(value);
  }
  return {
    actions,
    clear: async () => {
      await Promise.all(requests.map((request) => cache.delete(request)));
    },
  };
}
