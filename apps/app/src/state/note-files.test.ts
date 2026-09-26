import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type IndexedDbStoreDouble,
  installMultiStoreIndexedDbDouble,
} from '@/features/network/indexeddb-test-double';

const { thumbnailForFile } = vi.hoisted(() => ({
  thumbnailForFile: vi.fn(async () => undefined),
}));

vi.mock('@/state/thumbnails', () => ({
  attachmentThumbnails: {
    forFile: thumbnailForFile,
  },
}));

vi.mock('@/state/note-library-sync', () => ({
  schedulePatientNotesLibrarySync: vi.fn(),
}));

class CustomEventDouble<T = unknown> extends Event {
  readonly detail: T;

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type);
    this.detail = init?.detail as T;
  }
}

function installStores(): {
  readonly files: Map<string, Record<string, unknown>>;
  readonly transcripts: Map<string, Record<string, unknown>>;
} {
  const files = new Map<string, Record<string, unknown>>();
  const transcripts = new Map<string, Record<string, unknown>>();
  installMultiStoreIndexedDbDouble(
    new Map<string, IndexedDbStoreDouble>([
      ['files', { keyPath: 'id', records: files }],
      ['transcripts', { keyPath: 'fileId', records: transcripts }],
    ]),
  );
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  });
  vi.stubGlobal('CustomEvent', CustomEventDouble);
  return { files, transcripts };
}

afterEach(() => {
  thumbnailForFile.mockClear();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('note-file transcript retention', () => {
  it('deletes the old transcript only after a replacement file is committed', async () => {
    const { files, transcripts } = installStores();
    const fileId = 'file-old-audio';
    files.set(fileId, {
      id: fileId,
      noteId: 'note-1',
      name: 'old.webm',
      mimeType: 'audio/webm',
      size: 3,
      blob: new Blob(['old'], { type: 'audio/webm' }),
      createdAt: '2026-09-26T07:00:00.000Z',
    });
    transcripts.set(fileId, {
      fileId,
      noteId: 'note-1',
      text: 'Старая расшифровка',
      status: 'done',
      createdAt: '2026-09-26T07:00:00.000Z',
      updatedAt: '2026-09-26T07:00:00.000Z',
    });

    const { replaceNoteFile } = await import('./note-files');
    const replacement = await replaceNoteFile(
      fileId,
      new File(['new'], 'new.webm', { type: 'audio/webm' }),
    );

    expect(replacement.id).not.toBe(fileId);
    expect(files.has(fileId)).toBe(false);
    expect(files.has(replacement.id)).toBe(true);
    expect(transcripts.has(fileId)).toBe(false);
  });

  it('does not delete a transcript when replacement fails before touching the file store', async () => {
    const { transcripts } = installStores();
    const fileId = 'file-missing-audio';
    transcripts.set(fileId, {
      fileId,
      noteId: 'note-2',
      text: 'Нельзя потерять этот текст',
      status: 'done',
      createdAt: '2026-09-26T07:00:00.000Z',
      updatedAt: '2026-09-26T07:00:00.000Z',
    });

    const { replaceNoteFile } = await import('./note-files');

    await expect(
      replaceNoteFile(fileId, new File(['new'], 'new.webm', { type: 'audio/webm' })),
    ).rejects.toThrow('Вложение уже удалено.');
    expect(transcripts.get(fileId)?.['text']).toBe('Нельзя потерять этот текст');
  });
});
