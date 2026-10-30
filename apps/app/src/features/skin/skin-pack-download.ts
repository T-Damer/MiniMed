import { getDownloadQueue } from '@/features/downloads/download-service';
import {
  installSkinPackFromCatalog,
  removeSkinPack,
  type SkinPackDescriptor,
  skinPackOffer,
} from '@/features/skin/skin-pack';

export const SKIN_DOWNLOAD_ID = 'skin:photo-pack';

/** The recipe version of a restored download: the checksum of the pack this build can fetch. */
export function skinPackDownloadVersion(): string | undefined {
  return skinPackOffer()?.bundleSha256;
}

/**
 * Downloads, verifies and installs the skin pack through the shared queue, so it shows in
 * Settings → «Загрузки» and a download cut by a restart resumes.
 */
export async function installSkinPack(
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<SkinPackDescriptor> {
  const item = skinPackOffer();
  if (!item) throw new Error('Пакет «Кожа по фото» пока не опубликован.');
  const descriptor = await getDownloadQueue().run(
    {
      id: SKIN_DOWNLOAD_ID,
      kind: 'skin',
      title: item.name,
      totalBytes: item.downloadBytes,
      resume: { kind: 'skin-pack', id: SKIN_DOWNLOAD_ID, version: item.bundleSha256 },
    },
    (context) => {
      context.phase('queued');
      return installSkinPackFromCatalog(item, {
        signal: context.signal,
        downloadContext: context,
        onProgress: (bytes, total) => {
          context.progress(bytes, total);
          onProgress?.(Math.min(0.99, bytes / total));
        },
      });
    },
    {
      ...(signal ? { signal } : {}),
      retry: () => installSkinPack(),
    },
  );
  onProgress?.(1);
  return descriptor;
}

export async function removeSkinPackDownload(): Promise<void> {
  await getDownloadQueue().cancel(SKIN_DOWNLOAD_ID);
  await removeSkinPack();
}
