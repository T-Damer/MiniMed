import { describe, expect, it, vi } from 'vitest';

vi.mock('@/state/note-files', async () => {
  const actual = await vi.importActual<typeof import('@/state/note-files')>('@/state/note-files');
  return {
    ...actual,
    noteFileSrc: (record: { readonly id: string }) => `blob:test:${record.id}`,
  };
});

import { recordToViewerState } from './note-attachment-viewer-state';

describe('note attachment viewer state', () => {
  it('keeps the persisted audio record available to transcription controls', () => {
    const record = {
      id: 'file-audio',
      noteId: 'note-1',
      name: 'приём.webm',
      mimeType: 'audio/webm',
      size: 1234,
      blob: new Blob(['audio'], { type: 'audio/webm' }),
      createdAt: '2026-09-25T09:00:00.000Z',
    };

    expect(recordToViewerState(record)).toEqual({
      kind: 'audio',
      name: 'приём.webm',
      src: 'blob:test:file-audio',
      record,
    });
  });

  it('does not attach a transcription record to an ordinary video preview', () => {
    const record = {
      id: 'file-video',
      noteId: 'note-1',
      name: 'осмотр.webm',
      mimeType: 'video/webm',
      size: 4321,
      blob: new Blob(['video'], { type: 'video/webm' }),
      createdAt: '2026-09-25T09:00:00.000Z',
    };

    expect(recordToViewerState(record)).toEqual({
      kind: 'video',
      name: 'осмотр.webm',
      src: 'blob:test:file-video',
    });
  });
});
