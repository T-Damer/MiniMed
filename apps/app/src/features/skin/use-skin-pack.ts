import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js';

import {
  type DownloadTask,
  downloadTaskFraction,
  isDownloadActive,
} from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import {
  readSkinPackDescriptor,
  type SkinPackCatalogItem,
  type SkinPackDescriptor,
  skinPackOffer,
  subscribeSkinPack,
} from '@/features/skin/skin-pack';
import {
  installSkinPack,
  removeSkinPackDownload,
  SKIN_DOWNLOAD_ID,
} from '@/features/skin/skin-pack-download';

export interface SkinPackController {
  /** The installed pack, or null. */
  readonly installed: Accessor<SkinPackDescriptor | null>;
  /** The pack this build can download; undefined while none is published. */
  readonly offer: Accessor<SkinPackCatalogItem | undefined>;
  /** An installed pack differs from the published one: it keeps working until updated. */
  readonly outdated: Accessor<boolean>;
  readonly task: Accessor<DownloadTask | undefined>;
  readonly busy: Accessor<'download' | 'remove' | null>;
  /** 0–1 while downloading. */
  readonly fraction: Accessor<number>;
  /** A failure to show in place; cleared by the next attempt. */
  readonly error: Accessor<string>;
  /** Resolves true once the pack is installed. */
  install(): Promise<boolean>;
  cancel(): void;
  remove(): Promise<void>;
}

/**
 * The skin pack as a Solid view: installed state, the download in the shared queue and its
 * progress. Reading never starts a download; only `install()` does (the person's tap).
 */
export function useSkinPack(): SkinPackController {
  const queue = getDownloadQueue();
  const [installed, setInstalled] = createSignal(readSkinPackDescriptor());
  const [offer, setOffer] = createSignal(skinPackOffer());
  const [task, setTask] = createSignal(queue.get(SKIN_DOWNLOAD_ID));
  const [removing, setRemoving] = createSignal(false);
  const [error, setError] = createSignal('');
  let disposed = false;
  const sync = (): void => {
    setInstalled(readSkinPackDescriptor());
    setOffer(skinPackOffer());
  };
  onMount(() => {
    sync();
    const stopPack = subscribeSkinPack(sync);
    const stopQueue = queue.subscribe(() => setTask(queue.get(SKIN_DOWNLOAD_ID)));
    setTask(queue.get(SKIN_DOWNLOAD_ID));
    onCleanup(() => {
      disposed = true;
      stopPack();
      stopQueue();
    });
  });
  const busy = (): 'download' | 'remove' | null => {
    const current = task();
    return removing() ? 'remove' : current && isDownloadActive(current) ? 'download' : null;
  };
  return {
    installed,
    offer,
    outdated: () => {
      const current = installed();
      const published = offer();
      return Boolean(current && published && current.checksum !== published.bundleSha256);
    },
    task,
    busy,
    fraction: () => {
      const current = task();
      return current ? (downloadTaskFraction(current) ?? 0) : 0;
    },
    error,
    install: async () => {
      if (busy()) return false;
      setError('');
      try {
        await installSkinPack();
        return true;
      } catch (cause) {
        if (!disposed && !(cause instanceof Error && cause.name === 'AbortError')) {
          setError('Не удалось скачать или проверить пакет.');
        }
        return false;
      }
    },
    cancel: () => {
      void queue.cancel(SKIN_DOWNLOAD_ID).catch(() => {
        if (!disposed) setError('Не удалось подтвердить отмену загрузки.');
      });
    },
    remove: async () => {
      if (busy()) return;
      setRemoving(true);
      setError('');
      try {
        await removeSkinPackDownload();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Не удалось удалить пакет.');
      } finally {
        sync();
        setRemoving(false);
      }
    },
  };
}
