import { afterEach, describe, expect, it, vi } from 'vitest';

import { addNoteImages } from '@/state/note-images';

describe('note image validation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects unsafe and oversized files before writing IndexedDB', async () => {
    vi.stubGlobal('indexedDB', {});

    await expect(
      addNoteImages('note-1', [new File(['<svg/>'], 'script.svg', { type: 'image/svg+xml' })]),
    ).rejects.toThrow('JPEG, PNG, WebP и GIF');
    await expect(
      addNoteImages('note-1', [
        new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.jpg', {
          type: 'image/jpeg',
        }),
      ]),
    ).rejects.toThrow('8 МБ');
  });
});
