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
  it('deletes the whole personal-notes notebook without touching patient-vault data', async () => {
    const env = installEnvironment();
    env.local.setItem('minimed.patient-notes.v1', JSON.stringify(snapshot));
    env.local.setItem(
      'minimed.patient-note-drafts.v1',
      JSON.stringify({
        'note-1': {
          noteId: 'note-1',
          text: 'Черновик',
          reminderDate: '',
          reminderTime: '',
          savedAt: '2026-09-26T07:00:00.000Z',
        },
      }),
    );
    env.local.setItem(
      'minimed.patient-note-revisions.v1',
      JSON.stringify({
        'note-1': {
          noteId: 'note-1',
          text: 'Предыдущая версия',
          savedAt: '2026-09-26T07:01:00.000Z',
        },
      }),
    );
    env.local.setItem('minimed.patient-vault.test-fixture', 'keep-me');
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
      createdAt: '2026-09-26T07:21:00.000Z',
    });
    env.transcripts.set('file-audio', {
      fileId: 'file-audio',
      noteId: 'note-1',
      text: 'Добрый день.',
      status: 'done',
      createdAt: '2026-09-26T07:22:00.000Z',
      updatedAt: '2026-09-26T07:23:00.000Z',
    });

    const { deleteAllPersonalNotes } = await import('./personal-notes-backup');
    await deleteAllPersonalNotes();

    const restoredSnapshot = JSON.parse(env.local.getItem('minimed.patient-notes.v1') ?? '{}') as {
      cards?: unknown[];
      notes?: unknown[];
    };
    expect(restoredSnapshot).toEqual({ cards: [], notes: [] });
    expect(env.files.size).toBe(0);
    expect(env.images.size).toBe(0);
    expect(env.transcripts.size).toBe(0);
    expect(env.local.getItem('minimed.patient-note-drafts.v1')).toBeNull();
    expect(env.local.getItem('minimed.patient-note-revisions.v1')).toBeNull();
    expect(env.local.getItem('minimed.patient-vault.test-fixture')).toBe('keep-me');
  });

  it('rejects an oversized export before reading attachment blobs', async () => {
    const env = installEnvironment();
    env.local.setItem('minimed.patient-notes.v1', JSON.stringify(snapshot));
    const arrayBuffer = vi.fn(async () => {
      throw new Error('Oversized export must not read attachment bytes.');
    });
    for (let index = 0; index < 6; index += 1) {
      env.files.set(`file-large-${index}`, {
        id: `file-large-${index}`,
        noteId: 'note-1',
        name: `large-${index}.bin`,
        mimeType: 'application/octet-stream',
        size: 64 * 1024 * 1024,
        blob: { arrayBuffer },
        createdAt: '2026-09-26T07:00:00.000Z',
      });
    }

    const { exportPersonalNotesBackup } = await import('./personal-notes-backup');

    await expect(exportPersonalNotesBackup()).rejects.toThrow('превышает лимит 512 МБ');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('preflights base64 expansion before allocating large backup blobs', async () => {
    const {
      estimatePersonalNotesBackupBytes,
      MAX_PERSONAL_NOTES_BACKUP_FILE_BYTES,
    } = await import('./personal-notes-backup');

    const makeFiles = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `file-${index}`,
        noteId: 'note-1',
        name: `file-${index}.bin`,
        mimeType: 'application/octet-stream',
        size: 64 * 1024 * 1024,
        createdAt: '2026-09-26T07:00:00.000Z',
      }));

    expect(
      estimatePersonalNotesBackupBytes(
        {
          snapshot,
          files: makeFiles(5),
          images: [],
          transcripts: [],
        },
        { kind: 'all' },
      ),
    ).toBeLessThan(MAX_PERSONAL_NOTES_BACKUP_FILE_BYTES);

    expect(
      estimatePersonalNotesBackupBytes(
        {
          snapshot,
          files: makeFiles(6),
          images: [],
          transcripts: [],
        },
        { kind: 'all' },
      ),
    ).toBeGreaterThan(MAX_PERSONAL_NOTES_BACKUP_FILE_BYTES);
  });

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

  it('exports one card and imports it without replacing unrelated cards', async () => {
    const env = installEnvironment();
    const twoCards = {
      cards: [
        snapshot.cards[0],
        {
          id: 'card-2',
          title: 'Пациент Б',
          summary: 'Оставить без изменений',
          createdAt: '2026-09-26T06:00:00.000Z',
          updatedAt: '2026-09-26T06:30:00.000Z',
        },
      ],
      notes: [
        snapshot.notes[0],
        {
          id: 'note-2',
          cardId: 'card-2',
          parentNoteId: null,
          title: 'Другая запись',
          text: 'Не менять',
          createdAt: '2026-09-26T06:10:00.000Z',
          updatedAt: '2026-09-26T06:20:00.000Z',
          categories: ['Общее'],
          relatedDocumentIds: [],
        },
      ],
    };
    env.local.setItem('minimed.patient-notes.v1', JSON.stringify(twoCards));
    env.local.setItem(
      'minimed.patient-note-drafts.v1',
      JSON.stringify({
        'note-1': {
          noteId: 'note-1',
          text: 'Черновик заменяемой карточки',
          reminderDate: '',
          reminderTime: '',
          savedAt: '2026-09-26T07:00:00.000Z',
        },
        'note-2': {
          noteId: 'note-2',
          text: 'Черновик другой карточки',
          reminderDate: '',
          reminderTime: '',
          savedAt: '2026-09-26T07:00:00.000Z',
        },
      }),
    );
    env.files.set('file-audio', {
      id: 'file-audio',
      noteId: 'note-1',
      name: 'приём.webm',
      mimeType: 'audio/webm',
      size: 3,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
      createdAt: '2026-09-26T07:20:00.000Z',
    });
    env.files.set('file-other', {
      id: 'file-other',
      noteId: 'note-2',
      name: 'другой.txt',
      mimeType: 'text/plain',
      size: 1,
      blob: new Blob([new Uint8Array([9])], { type: 'text/plain' }),
      createdAt: '2026-09-26T06:25:00.000Z',
    });

    const { exportPersonalNotesCardBackup, importPersonalNotesBackup } = await import(
      './personal-notes-backup'
    );
    const backup = await exportPersonalNotesCardBackup('card-1');

    expect(backup.scope).toEqual({ kind: 'card', cardId: 'card-1' });
    expect(backup.snapshot.cards.map((card) => card.id)).toEqual(['card-1']);
    expect(backup.snapshot.notes.map((note) => note.id)).toEqual(['note-1']);
    expect(backup.files.map((file) => file.id)).toEqual(['file-audio']);

    env.local.setItem(
      'minimed.patient-notes.v1',
      JSON.stringify({
        cards: [
          {
            ...snapshot.cards[0],
            title: 'Старая версия карточки А',
          },
          twoCards.cards[1],
        ],
        notes: [
          {
            ...snapshot.notes[0],
            text: 'Старая версия записи А',
          },
          twoCards.notes[1],
        ],
      }),
    );
    env.files.delete('file-audio');

    await importPersonalNotesBackup(backup);

    const restored = JSON.parse(env.local.getItem('minimed.patient-notes.v1') ?? '{}') as {
      cards: Array<{ id: string; title: string }>;
      notes: Array<{ id: string; text: string }>;
    };
    expect(restored.cards.find((card) => card.id === 'card-1')?.title).toBe('Пациент А');
    expect(restored.cards.find((card) => card.id === 'card-2')?.title).toBe('Пациент Б');
    expect(restored.notes.find((note) => note.id === 'note-1')?.text).toBe(
      'Жалобы на бессонницу.',
    );
    expect(restored.notes.find((note) => note.id === 'note-2')?.text).toBe('Не менять');
    expect(env.files.has('file-audio')).toBe(true);
    expect(env.files.has('file-other')).toBe(true);
    const drafts = JSON.parse(env.local.getItem('minimed.patient-note-drafts.v1') ?? '{}') as Record<
      string,
      unknown
    >;
    expect(drafts['note-1']).toBeUndefined();
    expect(drafts['note-2']).toBeDefined();
  });

  it('rejects a card backup whose note id collides with another card', async () => {
    const env = installEnvironment();
    env.local.setItem(
      'minimed.patient-notes.v1',
      JSON.stringify({
        cards: [
          {
            id: 'card-existing',
            title: 'Существующая карточка',
            summary: '',
            createdAt: '2026-09-26T06:00:00.000Z',
            updatedAt: '2026-09-26T06:00:00.000Z',
          },
        ],
        notes: [
          {
            id: 'note-collision',
            cardId: 'card-existing',
            parentNoteId: null,
            title: '',
            text: 'Существующая запись',
            createdAt: '2026-09-26T06:10:00.000Z',
            updatedAt: '2026-09-26T06:10:00.000Z',
            categories: ['Общее'],
            relatedDocumentIds: [],
          },
        ],
      }),
    );
    const { importPersonalNotesBackup } = await import('./personal-notes-backup');
    const colliding = {
      kind: 'minimed-personal-notes-backup',
      schemaVersion: 1,
      exportedAt: '2026-09-26T08:00:00.000Z',
      scope: { kind: 'card', cardId: 'card-imported' },
      snapshot: {
        cards: [
          {
            id: 'card-imported',
            title: 'Импортируемая карточка',
            summary: '',
            createdAt: '2026-09-26T07:00:00.000Z',
            updatedAt: '2026-09-26T07:00:00.000Z',
          },
        ],
        notes: [
          {
            id: 'note-collision',
            cardId: 'card-imported',
            parentNoteId: null,
            title: '',
            text: 'Нельзя перезаписать чужую запись',
            createdAt: '2026-09-26T07:10:00.000Z',
            updatedAt: '2026-09-26T07:10:00.000Z',
            categories: ['Общее'],
            relatedDocumentIds: [],
          },
        ],
      },
      files: [],
      images: [],
      transcripts: [],
    };

    await expect(importPersonalNotesBackup(colliding)).rejects.toThrow(
      'ID заметки из backup уже используется другой карточкой',
    );
    const current = JSON.parse(env.local.getItem('minimed.patient-notes.v1') ?? '{}') as {
      cards?: Array<{ id?: string }>;
      notes?: Array<{ id?: string; text?: string }>;
    };
    expect(current.cards?.map((card) => card.id)).toEqual(['card-existing']);
    expect(current.notes?.[0]).toMatchObject({
      id: 'note-collision',
      text: 'Существующая запись',
    });
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
