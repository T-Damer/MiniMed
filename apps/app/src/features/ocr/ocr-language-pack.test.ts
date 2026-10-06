import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDownloadQueueForTests } from '@/features/downloads/download-service';

const ENGLISH = new Uint8Array([31, 139, 8, 0, 1, 1, 1, 1]);
const RUSSIAN = new Uint8Array([31, 139, 8, 0, 2, 2, 2, 2, 2, 2]);
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const downloadWithRetry = vi.hoisted(() => vi.fn());
const writeOcrPackFiles = vi.hoisted(() => vi.fn());
const deleteOcrPackFiles = vi.hoisted(() => vi.fn());
const hasOcrPackFiles = vi.hoisted(() => vi.fn());

vi.mock('@/features/network/download-retry', () => ({ downloadWithRetry }));
vi.mock('./ocr-language-pack-store', () => ({
  writeOcrPackFiles,
  deleteOcrPackFiles,
  hasOcrPackFiles,
}));
vi.mock('./ocr-language-pack-catalog', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ocr-language-pack-catalog')>();
  const files = [
    {
      language: 'eng' as const,
      sources: ['https://one.invalid/eng', 'https://two.invalid/eng'],
      bytes: ENGLISH.byteLength,
      sha256: sha(ENGLISH),
    },
    {
      language: 'rus' as const,
      sources: ['https://one.invalid/rus', 'https://two.invalid/rus'],
      bytes: RUSSIAN.byteLength,
      sha256: sha(RUSSIAN),
    },
  ];
  return {
    ...original,
    OCR_LANGUAGE_PACK_FILES: files,
    OCR_LANGUAGE_PACK_TOTAL_BYTES: ENGLISH.byteLength + RUSSIAN.byteLength,
  };
});

const {
  ensureOcrLanguagePackFiles,
  installOcrLanguagePack,
  isOcrLanguagePackInstalled,
  removeOcrLanguagePack,
} = await import('./ocr-language-pack');

function bytesBySource(table: Readonly<Record<string, Uint8Array>>): void {
  downloadWithRetry.mockImplementation(async (options: { readonly url: string }) => {
    const bytes = table[options.url];
    if (!bytes) throw new Error(`Сервер ответил HTTP 503 для ${options.url}`);
    return Uint8Array.from(bytes);
  });
}

describe('OCR language pack install', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('window', new EventTarget());
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    writeOcrPackFiles.mockResolvedValue(undefined);
    deleteOcrPackFiles.mockResolvedValue(undefined);
    hasOcrPackFiles.mockResolvedValue(true);
  });

  afterEach(async () => {
    await resetDownloadQueueForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const mock of [
      downloadWithRetry,
      writeOcrPackFiles,
      deleteOcrPackFiles,
      hasOcrPackFiles,
    ]) {
      mock.mockReset();
    }
  });

  it('downloads both files, verifies them and commits them together', async () => {
    bytesBySource({
      'https://one.invalid/eng': ENGLISH,
      'https://one.invalid/rus': RUSSIAN,
    });
    const progress: number[] = [];
    expect(isOcrLanguagePackInstalled()).toBe(false);

    await installOcrLanguagePack(new AbortController().signal, (fraction) =>
      progress.push(fraction),
    );

    expect(writeOcrPackFiles).toHaveBeenCalledTimes(1);
    const stored = writeOcrPackFiles.mock.calls[0]?.[0] as ReadonlyMap<string, Uint8Array>;
    expect([...stored.keys()]).toEqual(['eng', 'rus']);
    expect([...(stored.get('rus') ?? [])]).toEqual([...RUSSIAN]);
    expect(isOcrLanguagePackInstalled()).toBe(true);
    expect(progress.at(-1)).toBe(1);
    expect(downloadWithRetry).toHaveBeenCalledTimes(2);
  });

  it('falls back to the next mirror when one fails, and when one serves wrong bytes', async () => {
    const corrupted = Uint8Array.from(ENGLISH);
    corrupted[7] = 200;
    bytesBySource({
      'https://one.invalid/eng': corrupted,
      'https://two.invalid/eng': ENGLISH,
      // «one» is down for Russian: no entry means HTTP 503.
      'https://two.invalid/rus': RUSSIAN,
    });

    await installOcrLanguagePack();

    const urls = downloadWithRetry.mock.calls.map((call) => (call[0] as { url: string }).url);
    expect(urls).toEqual([
      'https://one.invalid/eng',
      'https://two.invalid/eng',
      'https://one.invalid/rus',
      'https://two.invalid/rus',
    ]);
    expect(isOcrLanguagePackInstalled()).toBe(true);
  });

  it('stores nothing when no mirror serves matching bytes', async () => {
    const corrupted = Uint8Array.from(RUSSIAN);
    corrupted[0] = 0;
    bytesBySource({
      'https://one.invalid/eng': ENGLISH,
      'https://one.invalid/rus': corrupted,
      'https://two.invalid/rus': corrupted,
    });

    await expect(installOcrLanguagePack()).rejects.toThrow(/контрольная сумма/u);

    expect(writeOcrPackFiles).not.toHaveBeenCalled();
    expect(isOcrLanguagePackInstalled()).toBe(false);
  });

  it('does not try another mirror once the user cancelled', async () => {
    const controller = new AbortController();
    downloadWithRetry.mockImplementation(async () => {
      controller.abort();
      throw new DOMException('Загрузка отменена.', 'AbortError');
    });

    await expect(installOcrLanguagePack(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(downloadWithRetry).toHaveBeenCalledTimes(1);
    expect(writeOcrPackFiles).not.toHaveBeenCalled();
  });

  it('forgets an installed pack whose files were cleared from the browser store', async () => {
    bytesBySource({ 'https://one.invalid/eng': ENGLISH, 'https://one.invalid/rus': RUSSIAN });
    await installOcrLanguagePack();
    expect(await ensureOcrLanguagePackFiles()).toBe(true);

    hasOcrPackFiles.mockResolvedValue(false);

    expect(await ensureOcrLanguagePackFiles()).toBe(false);
    expect(isOcrLanguagePackInstalled()).toBe(false);
  });

  it('removes the descriptor and the stored files', async () => {
    bytesBySource({ 'https://one.invalid/eng': ENGLISH, 'https://one.invalid/rus': RUSSIAN });
    await installOcrLanguagePack();

    await removeOcrLanguagePack();

    expect(isOcrLanguagePackInstalled()).toBe(false);
    expect(deleteOcrPackFiles).toHaveBeenCalledWith(['eng', 'rus']);
  });
});
