import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installMultiStoreIndexedDbDouble,
  type IndexedDbStoreDouble,
} from '@/features/network/indexeddb-test-double';

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

function localStorageDouble(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function installEnvironment(): {
  readonly local: Storage;
  readonly files: Map<string, Record<string, unknown>>;
  readonly images: Map<string, Record<string, unknown>>;
  readonly transcripts: Map<string, Record<string, unknown>>;
  readonly snapshots: Map<string, Record<string, unknown>>;
} {
  const files = new Map<string, Record<string, unknown>>();
  const images = new Map<string, Record<string, unknown>>();
  const transcripts = new Map<string, Record<string, unknown>>();
  const snapshots = new Map<string, Record<string, unknown>>();
  installMultiStoreIndexedDbDouble(
    new Map<string, IndexedDbStoreDouble>([
      ['files', { keyPath: 'id', records: files }],
      ['images', { keyPath: 'id', records: images }],
      ['transcripts', { keyPath: 'fileId', records: transcripts }],
      ['snapshots', { keyPath: 'id', records: snapshots }],
    ]),
  );
  const local = localStorageDouble();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('window', {
    localStorage: local,
    addEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  });
  vi.stubGlobal('CustomEvent', CustomEventDouble);
  return { local, files, images, transcripts, snapshots };
}

const snapshot = {
  cards: [
    {
      id: 'card-1',
      title: 'Пациент А',
      summary: 'Наблюдение',
      createdAt: '2026-09-26T07:00:00.000Z',
      updatedAt: '2026-09-26T08:00:00.000Z',
    },
  ],
  notes: [
    {
      id: 'note-1',
      cardId: 'card-1',
      parentNoteId: null,
      title: 'Приём',
      text: 'Жалобы на бессонницу.',
      createdAt: '2026-09-26T07:10:00.000Z',
      updatedAt: '2026-09-26T08:00:00.000Z',
      categories: ['Общее'],
      relatedDocumentIds: [],
    },
  ],
};

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('portable personal-notes backup', () => {
  it('round-trips stable note, attachment, image and transcript ids', async () => {
    const env = installEnvironment();
    env.local.setItem('minimed.patient-notes.v1', JSON.stringify(snapshot));
    env.files.set('file-audio', {
      id: 'file-audio',
      noteId: 'note-1',
      name: 'приём.webm',
      mimeType: 'audio/webm',
      size: 3,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
      createdAt: '2026-09-26T07:20:00.000Z',
    });
    env.images.set('image-1', {
      id: 'image-1',
      noteId: 'note-1',
      name: 'фото.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AQID',
      thumbnailDataUrl: 'data:image/png;base64,AQID',
      createdAt: '2026-09-26T07:21:00.000Z',
    });
    env.local.setItem(
      'minimed.patient-note-drafts.v1',
      JSON.stringify({
        'note-1': {
          noteId: 'note-1',
          title: 'Старый черновик',
          text: 'Черновик до импорта',
          categories: 'Общее',
          reminderDate: '',
          reminderTime: '',
          savedAt: '2026-09-26T07:30:00.000Z',
        },
      }),
    );
    env.local.setItem(
      'minimed.patient-note-revisions.v1',
      JSON.stringify({
        'note-1': {
          noteId: 'note-1',
          text: 'Предыдущая версия до импорта',
          savedAt: '2026-09-26T07:31:00.000Z',
        },
      }),
    );
    env.transcripts.set('file-audio', {
      fileId: 'file-audio',
      noteId: 'note-1',
      text: 'Добрый день.',
      segments: [
        {
          speakerId: 'speaker-1',
          startMs: 0,
          endMs: 1_000,
          text: 'Добрый день.',
        },
      ],
      speakerNames: { 'speaker-1': 'Врач' },
      diarized: true,
      status: 'done',
      createdAt: '2026-09-26T07:22:00.000Z',
      updatedAt: '2026-09-26T07:23:00.000Z',
    });

    const { exportPersonalNotesBackup, importPersonalNotesBackup } = await import(
      './personal-notes-backup'
    );
    const backup = await exportPersonalNotesBackup();

    expect(backup.snapshot.notes[0]?.id).toBe('note-1');
    expect(backup.files[0]).toMatchObject({
      id: 'file-audio',
      noteId: 'note-1',
      sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
      bytesBase64: 'AQID',
    });
    expect(backup.transcripts[0]?.speakerNames).toEqual({ 'speaker-1': 'Врач' });

    env.local.setItem(
      'minimed.patient-notes.v1',
      JSON.stringify({
        cards: [
          {
            id: 'other-card',
            title: 'Другая карточка',
            summary: '',
            createdAt: '2026-09-26T09:00:00.000Z',
            updatedAt: '2026-09-26T09:00:00.000Z',
          },
        ],
        notes: [],
      }),
    );
    env.files.clear();
    env.images.clear();
    env.transcripts.clear();

    await importPersonalNotesBackup(backup);

    const restoredSnapshot = JSON.parse(env.local.getItem('minimed.patient-notes.v1') ?? '{}') as {
      cards?: Array<{ id?: string }>;
      notes?: Array<{ id?: string }>;
    };
    expect(restoredSnapshot.cards?.map((card) => card.id)).toEqual(['card-1']);
    expect(restoredSnapshot.notes?.map((note) => note.id)).toEqual(['note-1']);
    expect(env.files.get('file-audio')).toMatchObject({
      id: 'file-audio',
      noteId: 'note-1',
      size: 3,
    });
    const restoredBlob = env.files.get('file-audio')?.blob as Blob;
    expect([...new Uint8Array(await restoredBlob.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(env.images.get('image-1')?.id).toBe('image-1');
    expect(env.transcripts.get('file-audio')).toMatchObject({
      fileId: 'file-audio',
      noteId: 'note-1',
      speakerNames: { 'speaker-1': 'Врач' },
      status: 'done',
    });
    expect(env.local.getItem('minimed.patient-note-drafts.v1')).toBeNull();
    expect(env.local.getItem('minimed.patient-note-revisions.v1')).toBeNull();
  });

  it('rejects same-size attachment corruption before mutating current notes', async () => {
    const env = installEnvironment();
    env.local.setItem('minimed.patient-notes.v1', JSON.stringify(snapshot));
    const { importPersonalNotesBackup } = await import('./personal-notes-backup');

    const corrupt = {
      kind: 'minimed-personal-notes-backup',
      schemaVersion: 1,
      exportedAt: '2026-09-26T08:00:00.000Z',
      snapshot,
      files: [
        {
          id: 'file-audio',
          noteId: 'note-1',
          name: 'приём.webm',
          mimeType: 'audio/webm',
          size: 3,
          sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
          bytesBase64: 'BAUG',
          createdAt: '2026-09-26T07:20:00.000Z',
        },
      ],
      images: [],
      transcripts: [],
    };

    await expect(importPersonalNotesBackup(corrupt)).rejects.toThrow('Контрольная сумма вложения');
    const current = JSON.parse(env.local.getItem('minimed.patient-notes.v1') ?? '{}') as {
      cards?: Array<{ id?: string }>;
    };
    expect(current.cards?.[0]?.id).toBe('card-1');
    expect(env.files.size).toBe(0);
  });

  it('rejects a transcript that is not linked to its source audio before mutating data', async () => {
    const env = installEnvironment();
    env.local.setItem('minimed.patient-notes.v1', JSON.stringify(snapshot));
    env.local.setItem(
      'minimed.patient-note-drafts.v1',
      JSON.stringify({
        'note-1': {
          noteId: 'note-1',
          text: 'Не удалять при отказе импорта',
          reminderDate: '',
          reminderTime: '',
          savedAt: '2026-09-26T07:00:00.000Z',
        },
      }),
    );
    const { importPersonalNotesBackup } = await import('./personal-notes-backup');

    const broken = {
      kind: 'minimed-personal-notes-backup',
      schemaVersion: 1,
      exportedAt: '2026-09-26T08:00:00.000Z',
      snapshot,
      files: [],
      images: [],
      transcripts: [
        {
          fileId: 'missing-audio',
          noteId: 'note-1',
          text: 'Текст',
          status: 'done',
          createdAt: '2026-09-26T07:00:00.000Z',
          updatedAt: '2026-09-26T07:00:00.000Z',
        },
      ],
    };

    await expect(importPersonalNotesBackup(broken)).rejects.toThrow(
      'не связана с исходной аудиозаписью',
    );
    const current = JSON.parse(env.local.getItem('minimed.patient-notes.v1') ?? '{}') as {
      cards?: Array<{ id?: string }>;
    };
    expect(current.cards?.[0]?.id).toBe('card-1');
    expect(env.local.getItem('minimed.patient-note-drafts.v1')).not.toBeNull();
  });
});
