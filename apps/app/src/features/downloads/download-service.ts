import { DownloadQueue } from './download-queue';

const STORAGE_KEY = 'minimed.download-queue.v1';
let shared: DownloadQueue | undefined;
let stopNetworkListeners: (() => void) | undefined;

/** Lightweight singleton; importing the indicator never initializes a database or model runtime. */
export function getDownloadQueue(): DownloadQueue {
  if (shared) return shared;
  const queue = new DownloadQueue(
    3,
    typeof window === 'undefined'
      ? undefined
      : {
          load: () => window.localStorage.getItem(STORAGE_KEY),
          save: (value) => window.localStorage.setItem(STORAGE_KEY, value),
        },
  );
  shared = queue;
  if (typeof window !== 'undefined') {
    const online = (): void => queue.setOnline(navigator.onLine !== false);
    online();
    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    stopNetworkListeners = () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
    };
  }
  return queue;
}

export async function resetDownloadQueueForTests(): Promise<void> {
  await shared?.cancelAll();
  stopNetworkListeners?.();
  stopNetworkListeners = undefined;
  shared = undefined;
}
