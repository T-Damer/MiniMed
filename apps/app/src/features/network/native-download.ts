import { Capacitor } from '@capacitor/core';

import type { ResumableDownloadOptions } from '@/features/network/resumable-download';

/** Android's actual DownloadManager response, not the plugin's cross-platform percentage type. */
export interface NativeDownloadStatus {
  readonly status: number;
  readonly bytesDownloaded: number;
  readonly bytesTotal: number;
  readonly reason?: number;
}

export interface AndroidDownloadPlugin {
  download(options: {
    readonly id: string;
    readonly url: string;
    readonly destination: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly notification: 'visible';
  }): Promise<unknown>;
  checkStatus(options: { readonly id: string }): Promise<NativeDownloadStatus>;
  stop(options: { readonly id: string }): Promise<unknown>;
}

export interface NativeDownloadedFile {
  readonly id: string;
  readonly filePath: string;
  readonly sizeBytes: number;
}

interface NativeFileAccess {
  prepareNativeDownload(options: { readonly id: string }): Promise<{
    readonly destination: string;
    readonly filePath: string;
  }>;
  inspectNativeDownload(options: { readonly id: string }): Promise<{
    readonly filePath: string;
    readonly sizeBytes: number;
  }>;
}

function aborted(): DOMException {
  return new DOMException('Загрузка отменена.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw aborted();
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const done = (): void => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const cancel = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      reject(aborted());
    };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

/** Only public HTTPS transfers leave the browser path. Bundled/local files must not be enqueued. */
export function shouldUseNativeDownload(url: string): boolean {
  if (Capacitor.getPlatform() !== 'android') return false;
  const parsed = new URL(url, 'https://localhost');
  return (
    parsed.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  );
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

function failure(status: NativeDownloadStatus): Error {
  if (status.reason && status.reason >= 400 && status.reason <= 599) {
    return new Error(`Не удалось скачать файл: HTTP ${status.reason}.`);
  }
  if (status.reason === 1006) return new Error('Недостаточно места для загрузки.');
  if (status.reason === 1007) return new Error('Хранилище загрузок недоступно.');
  return new Error(`Системная загрузка завершилась с ошибкой (${status.reason ?? 'неизвестно'}).`);
}

async function identity(options: ResumableDownloadOptions): Promise<string> {
  // Hash a small identity, NEVER the downloaded body in JavaScript. Headers distinguish credentials
  // without persisting them in our ID journal. Source hash/edition is already included in cacheKey.
  const key = JSON.stringify([
    'native-download-v1',
    options.cacheKey,
    options.url,
    options.expectedBytes ?? null,
    Object.entries(options.headers ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  ]);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Persistent system transfers; same-ID consumers are serialized until the prior file is released. */
export function createNativeDownloadTransport(
  plugin: AndroidDownloadPlugin,
  files: NativeFileAccess,
  identify: (options: ResumableDownloadOptions) => Promise<string> = identity,
  pollMs = 500,
) {
  const tails = new Map<string, Promise<void>>();

  return async function withFile<T>(
    options: ResumableDownloadOptions,
    consume: (file: NativeDownloadedFile) => Promise<T>,
  ): Promise<T> {
    throwIfAborted(options.signal);
    const id = await identify(options);
    const previous = tails.get(id) ?? Promise.resolve();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    tails.set(id, tail);
    let acquired = false;
    const execute = async (): Promise<T> => {
      // No native operation is started while an earlier caller still reads this staging file.
      await previous;
      throwIfAborted(options.signal);
      const { destination } = await files.prepareNativeDownload({ id });
      throwIfAborted(options.signal);
      await plugin.download({
        id,
        url: options.url,
        destination,
        ...(options.headers ? { headers: options.headers } : {}),
        notification: 'visible',
      });
      acquired = true;
      for (;;) {
        throwIfAborted(options.signal);
        const status = await plugin.checkStatus({ id });
        const total = status.bytesTotal > 0 ? status.bytesTotal : (options.expectedBytes ?? null);
        options.onProgress?.({
          downloadedBytes: Math.max(0, status.bytesDownloaded),
          totalBytes: total,
        });
        if (status.status === 16) throw failure(status);
        if (status.status === 8) {
          const file = await files.inspectNativeDownload({ id });
          if (
            options.expectedBytes != null &&
            options.expectedBytes > 0 &&
            file.sizeBytes !== options.expectedBytes
          ) {
            throw new Error('Размер файла не совпал с описанием загрузки.');
          }
          throwIfAborted(options.signal);
          return await consume({ ...file, id });
        }
        if (![1, 2, 4].includes(status.status))
          throw new Error('Неизвестное состояние системной загрузки.');
        await delay(pollMs, options.signal);
      }
    };
    const outcome = await execute().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    try {
      // Cancellation waits for the real native stop; files survive until consumed.
      if (acquired) await plugin.stop({ id });
    } catch (cleanupError) {
      throw new AggregateError(
        outcome.ok ? [cleanupError] : [outcome.error, cleanupError],
        'Не удалось освободить системное задание загрузки.',
      );
    } finally {
      release();
      if (tails.get(id) === tail) tails.delete(id);
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  };
}

let transport: ReturnType<typeof createNativeDownloadTransport> | undefined;
let pluginPromise: Promise<AndroidDownloadPlugin> | undefined;

function getPlugin(): Promise<AndroidDownloadPlugin> {
  pluginPromise ??= import('@capgo/capacitor-downloader').then(
    ({ CapacitorDownloader }) => CapacitorDownloader as unknown as AndroidDownloadPlugin,
  );
  return pluginPromise;
}

async function getTransport(): Promise<ReturnType<typeof createNativeDownloadTransport>> {
  const plugin = await getPlugin();
  const { LocalMedDatabase } = await import('@localmed/storage-capacitor');
  transport ??= createNativeDownloadTransport(plugin, LocalMedDatabase);
  return transport;
}

/** Inspection only: never starts network activity before the user's first consent. */
export async function hasRetainedNativeDownload(
  options: ResumableDownloadOptions,
): Promise<boolean> {
  try {
    const status = await (await getPlugin()).checkStatus({ id: await identity(options) });
    return [1, 2, 4, 8].includes(status.status);
  } catch (error) {
    if (errorCode(error) === 'NATIVE_DOWNLOAD_NOT_FOUND') return false;
    throw error;
  }
}

export async function withNativeDownloadedFile<T>(
  options: ResumableDownloadOptions,
  consume: (file: NativeDownloadedFile) => Promise<T>,
): Promise<T> {
  return (await getTransport())(options, consume);
}

export async function downloadNativeBytes(options: ResumableDownloadOptions): Promise<Uint8Array> {
  return withNativeDownloadedFile(options, async (file) => {
    // Legacy module/model consumers still require bytes. Core installation never takes this path.
    // No base64 bridge, global fetch patch, or simultaneous download body retained in WebView.
    const response = await fetch(Capacitor.convertFileSrc(file.filePath), {
      signal: options.signal ?? null,
    });
    if (!response.ok) throw new Error('Не удалось прочитать скачанный файл.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== file.sizeBytes)
      throw new Error('Размер файла не совпал после чтения.');
    return bytes;
  });
}
