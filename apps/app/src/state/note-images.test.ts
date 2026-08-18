import { afterEach, describe, expect, it, vi } from 'vitest';

import { addNoteImages, scaleThumbnailSize, THUMBNAIL_MAX_EDGE } from '@/state/note-images';

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

describe('scaleThumbnailSize', () => {
  it('keeps small images unchanged', () => {
    expect(scaleThumbnailSize(240, 180)).toEqual({ width: 240, height: 180 });
  });

  it('scales the longest edge to the thumbnail cap', () => {
    expect(scaleThumbnailSize(1920, 1080, THUMBNAIL_MAX_EDGE)).toEqual({
      width: THUMBNAIL_MAX_EDGE,
      height: 203,
    });
  });

  it('accepts optional thumbnailDataUrl on stored records', () => {
    const record = {
      id: 'image-1',
      noteId: 'note-1',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,abc',
      thumbnailDataUrl: 'data:image/webp;base64,thumb',
      createdAt: '2026-08-18T00:00:00.000Z',
    };
    expect(record.thumbnailDataUrl).toBeTruthy();
  });
});
