import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installMultiStoreIndexedDbDouble,
  type IndexedDbStoreDouble,
} from '@/features/network/indexeddb-test-double';

import {
  deleteTranscript,
  isTranscriptionQueued,
  queueTranscription,
  setTranscriptionEngine,
  updateTranscript,
} from './note-transcription';

interface TranscriptRecord {
  readonly fileId: string;
  readonly noteId: string;
  readonly text: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

class CustomEventDouble<T = unknown> extends Event {
  readonly detail: T;

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type);
    this.detail = init?.detail as T;
  }
}

function installTranscriptStore(): Map<string, Record<string, unknown>> {
  const records = new Map<string, Record<string, unknown>>();
  const stores = new Map<string, IndexedDbStoreDouble>([
    ['transcripts', { keyPath: 'fileId', records }],
  ]);
  installMultiStoreIndexedDbDouble(stores);
  vi.stubGlobal('window', { dispatchEvent: vi.fn(() => true) });
  vi.stubGlobal('CustomEvent', CustomEventDouble);
  return records;
}

afterEach(() => {
  setTranscriptionEngine(null);
  vi.unstubAllGlobals();
});

describe('note transcript retention', () => {
  it('tombstones an explicitly deleted transcript so a stale editor cannot recreate it', async () => {
    const records = installTranscriptStore();
    const fileId = 'file-delete-edit-race';
    records.set(fileId, {
      fileId,
      noteId: 'note-1',
      text: 'Исходный текст',
      status: 'done',
      createdAt: '2026-09-26T07:00:00.000Z',
      updatedAt: '2026-09-26T07:00:00.000Z',
    } satisfies TranscriptRecord);

    await deleteTranscript(fileId);

    expect(records.has(fileId)).toBe(false);
    await expect(
      updateTranscript({
        fileId,
        text: 'Позднее сохранение из уже открытого редактора',
      }),
    ).rejects.toThrow('Расшифровка удалена.');
    expect(records.has(fileId)).toBe(false);
  });

  it('does not recreate a transcript when an active Whisper job resolves after deletion', async () => {
    const records = installTranscriptStore();
    const fileId = 'file-active-delete-race';
    let resolveEngine: ((value: { readonly text: string }) => void) | undefined;
    const engineResult = new Promise<{ readonly text: string }>((resolve) => {
      resolveEngine = resolve;
    });

    setTranscriptionEngine(async () => engineResult);
    queueTranscription({
      fileId,
      noteId: 'note-2',
      blob: new Blob(['audio'], { type: 'audio/webm' }),
    });

    await vi.waitFor(() => {
      expect((records.get(fileId) as TranscriptRecord | undefined)?.status).toBe('running');
    });

    await deleteTranscript(fileId);
    expect(records.has(fileId)).toBe(false);

    resolveEngine?.({ text: 'Результат, пришедший после удаления' });

    await vi.waitFor(() => {
      expect(isTranscriptionQueued(fileId)).toBe(false);
    });
    expect(records.has(fileId)).toBe(false);
  });
});
