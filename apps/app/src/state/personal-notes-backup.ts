import {
  loadNoteFilesForNotes,
  MAX_NOTE_FILE_BYTES,
  type NoteFile,
  replaceAllNoteFiles,
} from '@/state/note-files';
import {
  loadNoteImagesForNotes,
  MAX_NOTE_IMAGE_BYTES,
  type NoteImage,
  replaceAllNoteImages,
} from '@/state/note-images';
import { runPendingNoteRetentionCleanup } from '@/state/note-retention-cleanup';
import {
  loadPatientNotes,
  parsePatientNotesSnapshot,
  type PatientNotesSnapshot,
  replacePatientNotesSnapshot,
} from '@/state/patient-notes';
import {
  loadTranscriptsForNotes,
  type NoteTranscript,
  parseRestoredTranscript,
  replaceAllTranscripts,
} from '@/state/note-transcription';

export const PERSONAL_NOTES_BACKUP_KIND = 'minimed-personal-notes-backup';
export const PERSONAL_NOTES_BACKUP_SCHEMA_VERSION = 1;
export const MAX_PERSONAL_NOTES_BACKUP_FILE_BYTES = 512 * 1024 * 1024;

const IMAGE_MIME_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

export interface PersonalNotesBackupFile {
  readonly id: string;
  readonly noteId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly bytesBase64: string;
  readonly thumbnailDataUrl?: string;
  readonly createdAt: string;
}

export interface PersonalNotesBackup {
  readonly kind: typeof PERSONAL_NOTES_BACKUP_KIND;
  readonly schemaVersion: typeof PERSONAL_NOTES_BACKUP_SCHEMA_VERSION;
  readonly exportedAt: string;
  readonly snapshot: PatientNotesSnapshot;
  readonly files: readonly PersonalNotesBackupFile[];
  readonly images: readonly NoteImage[];
  readonly transcripts: readonly NoteTranscript[];
}

interface PersonalNotesState {
  readonly snapshot: PatientNotesSnapshot;
  readonly files: readonly NoteFile[];
  readonly images: readonly NoteImage[];
  readonly transcripts: readonly NoteTranscript[];
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(new Date(value).getTime());
}

function validThumbnail(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/u.test(value))
  );
}

function base64DecodedLength(value: string): number {
  if (value.length === 0 || value.length % 4 !== 0) return -1;
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) return -1;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function base64ToBytes(value: string): Uint8Array {
  const expected = base64DecodedLength(value);
  if (expected < 0) throw new Error('Backup содержит повреждённые бинарные данные.');
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error('Backup содержит повреждённые бинарные данные.');
  }
  if (binary.length !== expected) throw new Error('Размер бинарных данных backup не совпадает.');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Every non-final chunk is divisible by three, so base64 chunks concatenate losslessly.
  const chunkSize = 3 * 16_384;
  const encoded: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(bytes.length, offset + chunkSize);
    let binary = '';
    for (let index = offset; index < end; index += 1) {
      binary += String.fromCharCode(bytes[index] ?? 0);
    }
    encoded.push(btoa(binary));
  }
  return encoded.join('');
}

function dataUrlDecodedLength(value: string, mimeType: string): number {
  const prefix = `data:${mimeType};base64,`;
  if (!value.startsWith(prefix)) return -1;
  return base64DecodedLength(value.slice(prefix.length));
}

function flatten<T>(
  noteIds: readonly string[],
  groups: ReadonlyMap<string, readonly T[]>,
): readonly T[] {
  return noteIds.flatMap((noteId) => groups.get(noteId) ?? []);
}

function parseBackupFile(value: unknown): PersonalNotesBackupFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Backup содержит повреждённое вложение.');
  }
  const candidate = value as Partial<PersonalNotesBackupFile>;
  if (
    typeof candidate.id !== 'string' ||
    !candidate.id ||
    typeof candidate.noteId !== 'string' ||
    !candidate.noteId ||
    typeof candidate.name !== 'string' ||
    !candidate.name ||
    typeof candidate.mimeType !== 'string' ||
    !candidate.mimeType ||
    typeof candidate.size !== 'number' ||
    !Number.isSafeInteger(candidate.size) ||
    candidate.size <= 0 ||
    candidate.size > MAX_NOTE_FILE_BYTES ||
    typeof candidate.bytesBase64 !== 'string' ||
    !validThumbnail(candidate.thumbnailDataUrl) ||
    !validDate(candidate.createdAt)
  ) {
    throw new Error('Backup содержит повреждённое вложение.');
  }
  if (base64DecodedLength(candidate.bytesBase64) !== candidate.size) {
    throw new Error(`Размер вложения «${candidate.name}» не совпадает с backup.`);
  }
  return candidate as PersonalNotesBackupFile;
}

function parseBackupImage(value: unknown): NoteImage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Backup содержит повреждённое изображение.');
  }
  const candidate = value as Partial<NoteImage>;
  if (
    typeof candidate.id !== 'string' ||
    !candidate.id ||
    typeof candidate.noteId !== 'string' ||
    !candidate.noteId ||
    typeof candidate.name !== 'string' ||
    !candidate.name ||
    typeof candidate.mimeType !== 'string' ||
    !IMAGE_MIME_TYPES.has(candidate.mimeType) ||
    typeof candidate.dataUrl !== 'string' ||
    !validThumbnail(candidate.thumbnailDataUrl) ||
    !validDate(candidate.createdAt)
  ) {
    throw new Error('Backup содержит повреждённое изображение.');
  }
  const imageBytes = dataUrlDecodedLength(candidate.dataUrl, candidate.mimeType);
  if (imageBytes < 0 || imageBytes > MAX_NOTE_IMAGE_BYTES) {
    throw new Error(`Изображение «${candidate.name}» повреждено или слишком велико.`);
  }
  return candidate as NoteImage;
}

function parseBackupTranscript(value: unknown): NoteTranscript {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Backup содержит повреждённую расшифровку.');
  }
  return parseRestoredTranscript(value as NoteTranscript);
}

export function parsePersonalNotesBackup(value: unknown): PersonalNotesBackup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Повреждён backup личных заметок.');
  }
  const candidate = value as {
    readonly kind?: unknown;
    readonly schemaVersion?: unknown;
    readonly exportedAt?: unknown;
    readonly snapshot?: unknown;
    readonly files?: unknown;
    readonly images?: unknown;
    readonly transcripts?: unknown;
  };
  if (candidate.kind !== PERSONAL_NOTES_BACKUP_KIND) {
    throw new Error('Это не backup личных заметок MiniMed.');
  }
  if (candidate.schemaVersion !== PERSONAL_NOTES_BACKUP_SCHEMA_VERSION) {
    throw new Error('Версия backup личных заметок не поддерживается.');
  }
  if (!validDate(candidate.exportedAt)) throw new Error('Дата backup повреждена.');

  const snapshot = parsePatientNotesSnapshot(candidate.snapshot);
  if (!Array.isArray(candidate.files) || !Array.isArray(candidate.images) || !Array.isArray(candidate.transcripts)) {
    throw new Error('Backup личных заметок неполный.');
  }
  const files = candidate.files.map(parseBackupFile);
  const images = candidate.images.map(parseBackupImage);
  const transcripts = candidate.transcripts.map(parseBackupTranscript);

  const noteIds = new Set(snapshot.notes.map((note) => note.id));
  const fileIds = new Set<string>();
  const filesById = new Map<string, PersonalNotesBackupFile>();
  for (const file of files) {
    if (!noteIds.has(file.noteId)) throw new Error('Backup содержит вложение без заметки.');
    if (fileIds.has(file.id)) throw new Error('ID вложений в backup должны быть уникальны.');
    fileIds.add(file.id);
    filesById.set(file.id, file);
  }

  const imageIds = new Set<string>();
  for (const image of images) {
    if (!noteIds.has(image.noteId)) throw new Error('Backup содержит изображение без заметки.');
    if (imageIds.has(image.id)) throw new Error('ID изображений в backup должны быть уникальны.');
    imageIds.add(image.id);
  }

  const transcriptIds = new Set<string>();
  for (const transcript of transcripts) {
    if (!noteIds.has(transcript.noteId)) {
      throw new Error('Backup содержит расшифровку без заметки.');
    }
    if (transcriptIds.has(transcript.fileId)) {
      throw new Error('Для одного аудиофайла в backup найдено несколько расшифровок.');
    }
    transcriptIds.add(transcript.fileId);
    const file = filesById.get(transcript.fileId);
    if (!file || file.noteId !== transcript.noteId || !file.mimeType.startsWith('audio/')) {
      throw new Error('Расшифровка в backup не связана с исходной аудиозаписью.');
    }
  }

  return {
    kind: PERSONAL_NOTES_BACKUP_KIND,
    schemaVersion: PERSONAL_NOTES_BACKUP_SCHEMA_VERSION,
    exportedAt: candidate.exportedAt,
    snapshot,
    files,
    images,
    transcripts,
  };
}

async function capturePersonalNotesState(): Promise<PersonalNotesState> {
  const snapshot = parsePatientNotesSnapshot(loadPatientNotes());
  const noteIds = snapshot.notes.map((note) => note.id);
  const [fileGroups, imageGroups, transcriptGroups] = await Promise.all([
    loadNoteFilesForNotes(noteIds),
    loadNoteImagesForNotes(noteIds),
    loadTranscriptsForNotes(noteIds),
  ]);
  return {
    snapshot,
    files: flatten(noteIds, fileGroups),
    images: flatten(noteIds, imageGroups),
    transcripts: flatten(noteIds, transcriptGroups),
  };
}

async function preparedStateFromBackup(backup: PersonalNotesBackup): Promise<PersonalNotesState> {
  const files = backup.files.map((file): NoteFile => {
    const bytes = base64ToBytes(file.bytesBase64);
    return {
      id: file.id,
      noteId: file.noteId,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      blob: new Blob([bytes], { type: file.mimeType }),
      ...(file.thumbnailDataUrl ? { thumbnailDataUrl: file.thumbnailDataUrl } : {}),
      createdAt: file.createdAt,
    };
  });
  return {
    snapshot: backup.snapshot,
    files,
    images: backup.images,
    transcripts: backup.transcripts,
  };
}

async function applyPersonalNotesState(state: PersonalNotesState): Promise<void> {
  // Cancel old speech jobs before replacing attachment IDs. The second transcript restore
  // writes the admitted backup records after all source blobs/images are in place.
  await replaceAllTranscripts([]);
  await replaceAllNoteFiles(state.files);
  await replaceAllNoteImages(state.images);
  await replaceAllTranscripts(state.transcripts);
  await replacePatientNotesSnapshot(state.snapshot);
}

export async function exportPersonalNotesBackup(): Promise<PersonalNotesBackup> {
  await runPendingNoteRetentionCleanup();
  const state = await capturePersonalNotesState();
  const files: PersonalNotesBackupFile[] = [];
  for (const file of state.files) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    files.push({
      id: file.id,
      noteId: file.noteId,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      bytesBase64: bytesToBase64(bytes),
      ...(file.thumbnailDataUrl ? { thumbnailDataUrl: file.thumbnailDataUrl } : {}),
      createdAt: file.createdAt,
    });
  }
  return parsePersonalNotesBackup({
    kind: PERSONAL_NOTES_BACKUP_KIND,
    schemaVersion: PERSONAL_NOTES_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    snapshot: state.snapshot,
    files,
    images: state.images,
    transcripts: state.transcripts,
  });
}

export async function importPersonalNotesBackup(value: unknown): Promise<PersonalNotesBackup> {
  const backup = parsePersonalNotesBackup(value);
  const prepared = await preparedStateFromBackup(backup);

  // Finish any previously journalled deletion before resurrecting stable IDs from a backup.
  await runPendingNoteRetentionCleanup();
  const previous = await capturePersonalNotesState();

  try {
    await applyPersonalNotesState(prepared);
    return backup;
  } catch (cause) {
    try {
      await applyPersonalNotesState(previous);
    } catch (rollbackCause) {
      throw new AggregateError(
        [cause, rollbackCause],
        'Импорт не завершён, а восстановить прежние личные заметки автоматически не удалось.',
      );
    }
    throw cause;
  }
}
