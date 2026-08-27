import { loadNoteFilesForNotes, type NoteFile } from '@/state/note-files';
import { loadNoteImagesForNotes, type NoteImage } from '@/state/note-images';
import { loadPatientNotes, type PatientCard, type PatientNote } from '@/state/patient-notes';
import {
  addUserLibraryFile,
  getUserLibraryFile,
  listUserLibraryDocuments,
  listUserLibraryFolders,
  moveUserLibraryDocument,
  removeUserLibraryDocument,
  replaceUserLibraryFile,
  USER_LIBRARY_NAME_MAX_LENGTH,
  USER_LIBRARY_NOTES_FOLDER_ID,
  type UserLibraryDocument,
  type UserLibraryDocumentSource,
} from '@/state/user-library';

interface NoteMirror {
  readonly source: UserLibraryDocumentSource;
  readonly file: File;
}

let running: Promise<void> | null = null;
let rerun = false;

function noteTitle(note: PatientNote): string {
  const firstLine = note.text
    .split('\n')
    .map((line) => line.replace(/^#+\s*|^[-*+]\s*|[*_`>]/gu, '').trim())
    .find(Boolean);
  return firstLine || 'Заметка';
}

function mirrorFileName(base: string, extension: string): string {
  const cleaned =
    base
      .replace(/[\\/\r\n:*?"<>|]/gu, ' ')
      .replaceAll('\u0000', ' ')
      .replace(/\s+/gu, ' ')
      .trim() || 'Заметка';
  const maxBaseLength = USER_LIBRARY_NAME_MAX_LENGTH - [...extension].length;
  return `${[...cleaned].slice(0, maxBaseLength).join('')}${extension}`;
}

function noteFileName(card: PatientCard, note: PatientNote): string {
  return mirrorFileName(`${card.title} — ${noteTitle(note)}`, '.md');
}

function sourceKey(source: UserLibraryDocumentSource): string {
  return source.kind === 'note'
    ? `note:${source.noteId}`
    : `attachment:${source.noteId}:${source.attachmentId}`;
}

function sameBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  return leftBytes.every((value, index) => value === rightBytes[index]);
}

async function noteMirrorNeedsUpdate(document: UserLibraryDocument, file: File): Promise<boolean> {
  if (
    document.fileName !== file.name ||
    document.mimeType !== file.type ||
    document.folderId !== USER_LIBRARY_NOTES_FOLDER_ID
  ) {
    return true;
  }
  const stored = await getUserLibraryFile(document.id);
  if (!stored) return true;
  return !sameBytes(await stored.arrayBuffer(), await file.arrayBuffer());
}

function attachmentMirrorNeedsUpdate(document: UserLibraryDocument, file: File): boolean {
  return (
    document.fileName !== file.name ||
    document.mimeType !== file.type ||
    document.byteLength !== file.size ||
    document.folderId !== USER_LIBRARY_NOTES_FOLDER_ID
  );
}

async function imageAsFile(image: NoteImage): Promise<File> {
  const response = await fetch(image.dataUrl);
  const blob = await response.blob();
  return new File([blob], image.name, { type: image.mimeType });
}

function noteAsFile(card: PatientCard, note: PatientNote): File {
  const content = note.text.trim() || `# ${noteTitle(note)}\n`;
  return new File([content], noteFileName(card, note), { type: 'text/markdown' });
}

function attachmentAsFile(record: NoteFile): File {
  return new File([record.blob], record.name, {
    type: record.mimeType || 'application/octet-stream',
  });
}

async function buildMirrors(): Promise<readonly NoteMirror[]> {
  const snapshot = loadPatientNotes();
  const cardsById = new Map(snapshot.cards.map((card) => [card.id, card]));
  const notes = snapshot.notes.filter((note) => cardsById.has(note.cardId));
  const noteIds = notes.map((note) => note.id);
  const [filesByNote, imagesByNote] = await Promise.all([
    loadNoteFilesForNotes(noteIds),
    loadNoteImagesForNotes(noteIds),
  ]);
  const mirrors: NoteMirror[] = [];

  for (const note of notes) {
    const card = cardsById.get(note.cardId);
    if (!card) continue;
    mirrors.push({
      source: { kind: 'note', noteId: note.id },
      file: noteAsFile(card, note),
    });
    for (const record of filesByNote.get(note.id) ?? []) {
      mirrors.push({
        source: { kind: 'note-attachment', noteId: note.id, attachmentId: record.id },
        file: attachmentAsFile(record),
      });
    }
    for (const image of imagesByNote.get(note.id) ?? []) {
      mirrors.push({
        source: { kind: 'note-attachment', noteId: note.id, attachmentId: image.id },
        file: await imageAsFile(image),
      });
    }
  }
  return mirrors;
}

async function syncOnce(): Promise<void> {
  await listUserLibraryFolders();
  const mirrors = await buildMirrors();
  const existing = (await listUserLibraryDocuments()).filter((document) => document.source);
  const bySource = new Map<string, UserLibraryDocument[]>();
  for (const document of existing) {
    const source = document.source;
    if (!source) continue;
    const bucket = bySource.get(sourceKey(source));
    if (bucket) bucket.push(document);
    else bySource.set(sourceKey(source), [document]);
  }
  const kept = new Set<string>();

  for (const mirror of mirrors) {
    const candidates = bySource.get(sourceKey(mirror.source)) ?? [];
    const current = candidates.shift();
    if (!current) {
      const created = await addUserLibraryFile(
        mirror.file,
        USER_LIBRARY_NOTES_FOLDER_ID,
        mirror.source,
      );
      kept.add(created.id);
      continue;
    }
    kept.add(current.id);
    const needsUpdate =
      mirror.source.kind === 'note'
        ? await noteMirrorNeedsUpdate(current, mirror.file)
        : attachmentMirrorNeedsUpdate(current, mirror.file);
    if (needsUpdate) {
      await replaceUserLibraryFile(current.id, mirror.file, {
        folderId: USER_LIBRARY_NOTES_FOLDER_ID,
        source: mirror.source,
      });
    } else if (current.folderId !== USER_LIBRARY_NOTES_FOLDER_ID) {
      await moveUserLibraryDocument(current.id, USER_LIBRARY_NOTES_FOLDER_ID);
    }
  }

  for (const document of existing) {
    if (!kept.has(document.id)) await removeUserLibraryDocument(document.id);
  }
}

export function syncPatientNotesToUserLibrary(): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      await syncOnce();
    } while (rerun);
  })().finally(() => {
    running = null;
  });
  return running;
}

export function schedulePatientNotesLibrarySync(): void {
  void syncPatientNotesToUserLibrary().catch((cause) => {
    console.warn(
      cause instanceof Error
        ? `Не удалось синхронизировать заметки с файлами: ${cause.message}`
        : 'Не удалось синхронизировать заметки с файлами.',
    );
  });
}
