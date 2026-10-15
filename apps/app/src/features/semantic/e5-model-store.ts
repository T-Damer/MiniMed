import { getDownloadQueue } from '@/features/downloads/download-service';
import { downloadWithRetry } from '@/features/network/download-retry';
import { invalidateSemanticState } from '@/state/search-data-version';
import {
  E5_DOWNLOAD_ID,
  E5_MODEL_FILES,
  E5_MODEL_REVISION,
  E5_MODEL_TOTAL_BYTES,
  type E5ModelPart,
  e5FileUrl,
} from './e5-model';
import {
  fileKey,
  removeStaleModelFiles,
  requestResult,
  type StoredModelFile,
  storedFile,
  validStored,
  withStore,
} from './e5-model-cache';
import { resolveE5ModelSource } from './e5-model-source';

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

/**
 * Downloads the missing files through the shared queue; each file is stored only once verified.
 * A build that bundles the model (Android) has nothing to download: resolves without queueing.
 */
export async function installE5Model(signal?: AbortSignal): Promise<void> {
  if ((await resolveE5ModelSource()).kind === 'bundled') return;
  await getDownloadQueue()
    .run(
      {
        id: E5_DOWNLOAD_ID,
        kind: 'model',
        title: 'Поиск по смыслу',
        totalBytes: E5_MODEL_TOTAL_BYTES,
        // A reload cuts the transfer; the restorer starts it again from the kept partial bytes.
        resume: { kind: 'semantic-model', id: E5_DOWNLOAD_ID, version: E5_MODEL_REVISION },
      },
      async (context) => {
        // Files of a previous model revision are never read again.
        await removeStaleModelFiles();
        let completed = 0;
        const fetchVerified = async (part: E5ModelPart, offset: number): Promise<Uint8Array> => {
          // Each file or part is verified as soon as it arrives; the next one is a download again.
          context.phase('downloading');
          const bytes = await downloadWithRetry({
            jobId: context.id,
            trackProgress: false,
            url: e5FileUrl(part.path),
            cacheKey: `semantic-model:${E5_DOWNLOAD_ID}/${part.path}:${part.sha256}`,
            expectedBytes: part.sizeBytes,
            signal: context.signal,
            retryMissingAssets: false,
            onProgress: ({ downloadedBytes }) =>
              context.progress(offset + downloadedBytes, E5_MODEL_TOTAL_BYTES),
          });
          context.phase('verifying');
          if (bytes.byteLength !== part.sizeBytes || (await sha256Hex(bytes)) !== part.sha256) {
            throw new Error(`Файл модели ${part.path} не прошёл проверку.`);
          }
          return bytes;
        };
        for (const file of E5_MODEL_FILES) {
          context.signal.throwIfAborted();
          if (!validStored(file, await storedFile(file))) {
            let bytes: Uint8Array;
            if (file.parts) {
              bytes = new Uint8Array(file.sizeBytes);
              let offset = 0;
              for (const part of file.parts) {
                bytes.set(await fetchVerified(part, completed + offset), offset);
                offset += part.sizeBytes;
              }
              if (offset !== file.sizeBytes || (await sha256Hex(bytes)) !== file.sha256) {
                throw new Error(`Файл модели ${file.path} не прошёл проверку.`);
              }
            } else {
              bytes = await fetchVerified(file, completed);
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
