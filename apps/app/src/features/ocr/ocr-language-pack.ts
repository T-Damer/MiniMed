import type { DownloadContext } from '@/features/downloads/download-queue';
import { getDownloadQueue } from '@/features/downloads/download-service';
import { downloadWithRetry } from '@/features/network/download-retry';
import {
  buildOcrLanguagePackDescriptor,
  OCR_LANGUAGE_PACK_FILES,
  OCR_LANGUAGE_PACK_TOTAL_BYTES,
  OCR_LANGUAGE_PACK_VERSION,
  type OcrLanguage,
  type OcrLanguagePackDescriptor,
  type OcrLanguagePackFile,
  parseOcrLanguagePackDescriptor,
  verifyOcrLanguageFile,
} from './ocr-language-pack-catalog';
import { deleteOcrPackFiles, hasOcrPackFiles, writeOcrPackFiles } from './ocr-language-pack-store';

const STORAGE_KEY = 'minimed.ocr-language-pack';
const CHANGE_EVENT = 'minimed:ocr-language-pack-change';

export const OCR_DOWNLOAD_ID = 'ocr:language-pack';
export const OCR_DOWNLOAD_TITLE = 'Распознавание текста (OCR)';

/** A mirror that is not the last one gets a short retry budget, so a dead CDN is left quickly. */
const FALLBACK_SOURCE_RETRY_DELAYS_MS = [1_000, 2_500] as const;

const OCR_LANGUAGES_IN_PACK: readonly OcrLanguage[] = OCR_LANGUAGE_PACK_FILES.map(
  (file) => file.language,
);

export function readOcrLanguagePackDescriptor(): OcrLanguagePackDescriptor | null {
  try {
    return parseOcrLanguagePackDescriptor(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch (cause) {
    console.warn('Описание языкового пакета OCR не прочитано.', cause);
    return null;
  }
}

/** Synchronous, for status labels: the pack counts as installed once it was fully committed. */
export function isOcrLanguagePackInstalled(): boolean {
  return readOcrLanguagePackDescriptor() !== null;
}

function writeDescriptor(descriptor: OcrLanguagePackDescriptor | null): void {
  if (descriptor) localStorage.setItem(STORAGE_KEY, JSON.stringify(descriptor));
  else localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeOcrLanguagePack(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * The descriptor says «installed», the files must really be there too: site data can be cleared
 * piecemeal. When they are gone the descriptor is dropped, so the app asks for the pack again
 * instead of failing inside the OCR worker.
 */
export async function ensureOcrLanguagePackFiles(): Promise<boolean> {
  if (!isOcrLanguagePackInstalled()) return false;
  if (await hasOcrPackFiles(OCR_LANGUAGES_IN_PACK)) return true;
  writeDescriptor(null);
  return false;
}

async function downloadVerifiedFile(
  file: OcrLanguagePackFile,
  context: DownloadContext,
  onBytes: (bytes: number) => void,
): Promise<Uint8Array> {
  const lastIndex = file.sources.length - 1;
  let lastError: unknown;
  for (const [index, url] of file.sources.entries()) {
    context.signal.throwIfAborted();
    try {
      const bytes = await downloadWithRetry({
        jobId: context.id,
        trackProgress: false,
        url,
        cacheKey: `ocr-language-pack:${OCR_LANGUAGE_PACK_VERSION}:${file.language}:${file.sha256}`,
        expectedBytes: file.bytes,
        signal: context.signal,
        retryMissingAssets: false,
        ...(index < lastIndex ? { retryDelaysMs: FALLBACK_SOURCE_RETRY_DELAYS_MS } : {}),
        onProgress: ({ downloadedBytes }) => onBytes(downloadedBytes),
      });
      context.phase('verifying');
      await verifyOcrLanguageFile(file, bytes);
      return bytes;
    } catch (cause) {
      if (context.signal.aborted || index === lastIndex) throw cause;
      lastError = cause;
      console.warn(`Источник языкового файла ${file.language} недоступен, пробуем следующий.`, {
        cause: lastError,
      });
    }
  }
  throw new Error(`Языковой файл ${file.language} не скачан.`, { cause: lastError });
}

async function installFiles(
  context: DownloadContext,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const verified = new Map<OcrLanguage, Uint8Array>();
  let completed = 0;
  for (const file of OCR_LANGUAGE_PACK_FILES) {
    context.signal.throwIfAborted();
    context.phase('queued');
    const bytes = await downloadVerifiedFile(file, context, (downloaded) => {
      context.progress(completed + downloaded, OCR_LANGUAGE_PACK_TOTAL_BYTES);
      onProgress(Math.min(0.99, (completed + downloaded) / OCR_LANGUAGE_PACK_TOTAL_BYTES));
    });
    verified.set(file.language, bytes);
    completed += file.bytes;
    context.progress(completed, OCR_LANGUAGE_PACK_TOTAL_BYTES);
  }
  context.signal.throwIfAborted();
  // Past this point the commit is atomic and cannot be cancelled half-way.
  context.phase('installing');
  await writeOcrPackFiles(verified);
  try {
    writeDescriptor(buildOcrLanguagePackDescriptor(new Date().toISOString()));
  } catch (cause) {
    await deleteOcrPackFiles(OCR_LANGUAGES_IN_PACK);
    throw cause;
  }
}

/** Downloads, verifies and stores both language files; resolves once OCR can use them offline. */
export async function installOcrLanguagePack(
  signal: AbortSignal = new AbortController().signal,
  onProgress: (fraction: number) => void = () => undefined,
): Promise<void> {
  await getDownloadQueue().run(
    {
      id: OCR_DOWNLOAD_ID,
      kind: 'ocr',
      title: OCR_DOWNLOAD_TITLE,
      totalBytes: OCR_LANGUAGE_PACK_TOTAL_BYTES,
      resume: {
        kind: 'ocr-language-pack',
        id: OCR_DOWNLOAD_ID,
        version: OCR_LANGUAGE_PACK_VERSION,
      },
    },
    (context) => installFiles(context, onProgress),
    { signal, retry: () => installOcrLanguagePack() },
  );
  onProgress(1);
}

export async function removeOcrLanguagePack(): Promise<void> {
  await getDownloadQueue().cancel(OCR_DOWNLOAD_ID);
  writeDescriptor(null);
  await deleteOcrPackFiles(OCR_LANGUAGES_IN_PACK);
}
