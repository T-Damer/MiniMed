import { getDownloadQueue } from '@/features/downloads/download-service';
import { downloadWithRetry } from '@/features/network/download-retry';
import { invalidateSemanticState } from '@/state/search-data-version';
import { E5_DOWNLOAD_ID, E5_MODEL_FILES, E5_MODEL_TOTAL_BYTES, e5FileUrl } from './e5-model';
import {
  fileKey,
  requestResult,
  type StoredModelFile,
  storedFile,
  validStored,
  withStore,
} from './e5-model-cache';

const listeners = new Set<() => void>();

export function subscribeE5Model(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  // Saved search results ranked without (or with) the model belong to another data version now.
  invalidateSemanticState();
  for (const listener of listeners) listener();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Downloads the missing files through the shared queue; each file is stored only once verified. */
export function installE5Model(signal?: AbortSignal): Promise<void> {
  return getDownloadQueue()
    .run(
      {
        id: E5_DOWNLOAD_ID,
        kind: 'model',
        title: 'Поиск по смыслу',
        totalBytes: E5_MODEL_TOTAL_BYTES,
      },
      async (context) => {
        let completed = 0;
        for (const file of E5_MODEL_FILES) {
          context.signal.throwIfAborted();
          if (!validStored(file, await storedFile(file))) {
            const bytes = await downloadWithRetry({
              jobId: context.id,
              trackProgress: false,
              url: e5FileUrl(file.path),
              cacheKey: `semantic-model:${fileKey(file)}:${file.sha256}`,
              expectedBytes: file.sizeBytes,
              signal: context.signal,
              retryMissingAssets: false,
              onProgress: ({ downloadedBytes }) =>
                context.progress(completed + downloadedBytes, E5_MODEL_TOTAL_BYTES),
            });
            context.phase('verifying');
            if (bytes.byteLength !== file.sizeBytes || (await sha256Hex(bytes)) !== file.sha256) {
              throw new Error(`Файл модели ${file.path} не прошёл проверку.`);
            }
            const record: StoredModelFile = {
              key: fileKey(file),
              sha256: file.sha256,
              data: new Blob([bytes as Uint8Array<ArrayBuffer>]),
            };
            await withStore('readwrite', (store) => requestResult(store.put(record)));
          }
          completed += file.sizeBytes;
          context.progress(completed, E5_MODEL_TOTAL_BYTES);
        }
      },
      { ...(signal ? { signal } : {}), retry: () => installE5Model() },
    )
    .finally(notify);
}

export async function removeE5Model(): Promise<void> {
  await withStore('readwrite', (store) => requestResult(store.clear()));
  notify();
}
