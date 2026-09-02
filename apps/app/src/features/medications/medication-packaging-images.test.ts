import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import {
  MedicationPackagingImageResolver,
  type ResolvedMedicationPackagingImage,
} from './medication-packaging-images';

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return `sha256:${[...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

async function imageArchive(): Promise<Uint8Array> {
  const image = new TextEncoder().encode('image-bytes');
  const jsZip = await import('jszip');
  const archive = new jsZip.default();
  archive.file(
    'manifest.json',
    JSON.stringify({
      distinctReferences: 1,
      failures: {},
      images: {
        'img/preparations/1.jpg': {
          allmedIds: [1],
          contentType: 'image/jpeg',
          sha256: await sha256(image),
          size: image.byteLength,
          sourceUrl: 'https://allmed.pro/img/preparations/1.jpg',
        },
      },
      rawDatabaseSha256: `sha256:${'a'.repeat(64)}`,
      rawDatabaseSourceUrl: 'https://allmed.pro',
      schemaVersion: 1,
      sourceUrl: 'https://allmed.pro',
      successfulReferences: 1,
      totalBytes: image.byteLength,
      totalReferences: 1,
    }),
  );
  archive.file('img/preparations/1.jpg', image);
  archive.file('img/preparations/not-requested.jpg', 'not requested');
  return archive.generateAsync({ type: 'uint8array' });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MedicationPackagingImageResolver', () => {
  it('rejects unsafe references before reading the installed archive', async () => {
    const readSourceAssets = vi.fn(async () => imageArchive());
    const resolver = new MedicationPackagingImageResolver({ readSourceAssets });

    await expect(resolver.resolve('../1.jpg')).resolves.toBeNull();
    await expect(resolver.resolve('https://allmed.pro/img/preparations/1.jpg')).resolves.toBeNull();
    await expect(resolver.resolve('img/preparations/1.jpg?download=1')).resolves.toBeNull();
    expect(readSourceAssets).not.toHaveBeenCalled();
    resolver.dispose();
  });

  it('loads only the requested entry, caches it, and clears it on content change', async () => {
    const archive = await imageArchive();
    const readSourceAssets = vi.fn(async () => archive);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:packaging-1');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('window', {
      addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
      removeEventListener: (event: string) => listeners.delete(event),
    });
    const resolver = new MedicationPackagingImageResolver({ readSourceAssets });

    const first = await resolver.resolve('img/preparations/1.jpg');
    const second = await resolver.resolve('img/preparations/1.jpg');

    expect(first).toEqual<ResolvedMedicationPackagingImage>({
      reference: 'img/preparations/1.jpg',
      url: 'blob:packaging-1',
      sourceUrl: 'https://allmed.pro/img/preparations/1.jpg',
      contentType: 'image/jpeg',
    });
    expect(second).toBe(first);
    expect(readSourceAssets).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();

    listeners.get(CONTENT_CHANGED_EVENT)?.();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:packaging-1');
    await resolver.resolve('img/preparations/1.jpg');
    expect(readSourceAssets).toHaveBeenCalledTimes(2);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    resolver.dispose();
  });
});
