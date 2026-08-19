import { Capacitor, registerPlugin } from '@capacitor/core';

import { downloadWithRetry } from '@/features/network/download-retry';

export const APK_BRIDGE_CHUNK_BYTES = 256 * 1024;

export interface ApkDownloadProgress {
  readonly loaded: number;
  readonly total: number;
}

export interface LocalMedUpdatePlugin {
  prepareApkFile(): Promise<{ readonly path: string }>;
  appendApkChunk(options: { readonly chunk: string }): Promise<{ readonly bytes: number }>;
  installPreparedApk(): Promise<{ readonly path: string }>;
}

const localMedUpdate = registerPlugin<LocalMedUpdatePlugin>('LocalMedUpdate');

export function assertHttpsApkUrl(url: string): void {
  if (!url.startsWith('https://')) {
    throw new Error('Only HTTPS APK URLs are allowed.');
  }
}

export function apkDownloadCacheKey(url: string): string {
  return `apk:${url}`;
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 8192;
  for (let offset = 0; offset < bytes.byteLength; offset += step) {
    const slice = bytes.subarray(offset, Math.min(offset + step, bytes.byteLength));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function splitBytesForBridge(
  bytes: Uint8Array,
  chunkBytes: number = APK_BRIDGE_CHUNK_BYTES,
): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
    chunks.push(bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.byteLength)));
  }
  return chunks;
}

export async function writeApkBytesToNative(
  bytes: Uint8Array,
  plugin: Pick<
    LocalMedUpdatePlugin,
    'prepareApkFile' | 'appendApkChunk' | 'installPreparedApk'
  > = localMedUpdate,
  chunkBytes: number = APK_BRIDGE_CHUNK_BYTES,
): Promise<void> {
  await plugin.prepareApkFile();
  for (const chunk of splitBytesForBridge(bytes, chunkBytes)) {
    await plugin.appendApkChunk({ chunk: encodeBytesToBase64(chunk) });
  }
  await plugin.installPreparedApk();
}

export async function installAndroidApk(
  url: string,
  onProgress?: (progress: ApkDownloadProgress) => void,
): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') {
    throw new Error('APK updates are available only on Android.');
  }
  assertHttpsApkUrl(url);
  const bytes = await downloadWithRetry({
    url,
    cacheKey: apkDownloadCacheKey(url),
    onProgress: ({ downloadedBytes, totalBytes }) => {
      onProgress?.({
        loaded: downloadedBytes,
        total: totalBytes ?? downloadedBytes,
      });
    },
  });
  await writeApkBytesToNative(bytes);
}
