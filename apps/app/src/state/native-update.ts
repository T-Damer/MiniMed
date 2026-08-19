import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';

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

function bytesFromBinaryString(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

function bytesFromBase64(value: string): Uint8Array {
  return bytesFromBinaryString(atob(value));
}

const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/u;

export function decodeCapacitorHttpBody(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data !== 'string') {
    throw new Error('CapacitorHttp returned an unsupported APK body type.');
  }
  const dataUrl = /^data:[^;]+;base64,([\s\S]*)/u.exec(data);
  if (dataUrl?.[1] !== undefined) {
    return bytesFromBase64(dataUrl[1].replace(/\s+/gu, ''));
  }
  // Native CapacitorHttp arraybuffer bodies are often a latin-1 string of raw bytes (APK = ZIP).
  if (data.startsWith('PK') || data.includes('\u0000')) {
    return bytesFromBinaryString(data);
  }
  const compact = data.replace(/\s+/gu, '');
  if (compact.length > 0 && compact.length % 4 === 0 && BASE64_BODY.test(compact)) {
    return bytesFromBase64(compact);
  }
  return bytesFromBinaryString(data);
}

export async function downloadApkBytesViaCapacitorHttp(
  url: string,
  onProgress?: (progress: ApkDownloadProgress) => void,
): Promise<Uint8Array> {
  onProgress?.({ loaded: 0, total: 0 });
  const response = await CapacitorHttp.get({
    url,
    responseType: 'arraybuffer',
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`APK download failed with status ${response.status}.`);
  }
  const bytes = decodeCapacitorHttpBody(response.data);
  onProgress?.({ loaded: bytes.byteLength, total: bytes.byteLength });
  return bytes;
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
  const bytes = await downloadApkBytesViaCapacitorHttp(url, onProgress);
  await writeApkBytesToNative(bytes);
}
