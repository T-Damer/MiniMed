/**
 * The doctor's own CBT diaries and homework sheets (CBT1) as files of the user library, in the system
 * folder «Дневники и задания» — the same library and the same pattern as «Мои опросники». The
 * format and its parser live in `user-worksheet-format.ts`.
 */
import {
  addUserLibraryFile,
  getUserLibraryDocument,
  getUserLibraryFile,
  isUserLibraryWorksheet,
  listUserLibraryDocuments,
  listUserLibraryFolders,
  removeUserLibraryDocument,
  replaceUserLibraryFile,
  USER_LIBRARY_WORKSHEET_MIME_TYPE,
  USER_LIBRARY_WORKSHEETS_FOLDER_ID,
  type UserLibraryDocument,
  userLibraryWorksheetFileName,
} from '@/state/user-library';
import {
  copyWorksheet,
  createUserWorksheetDraft,
  parseUserWorksheet,
  type UserWorksheet,
} from '@/state/user-worksheet-format';

export interface StoredUserWorksheet {
  readonly file: UserLibraryDocument;
  readonly worksheet: UserWorksheet;
}

function withUpdatedAt(worksheet: UserWorksheet): UserWorksheet {
  // An empty title while the doctor is typing must not stop the draft from saving.
  return {
    ...parseUserWorksheet({ ...worksheet, title: worksheet.title.trim() || 'Новый дневник' }),
    updatedAt: new Date().toISOString(),
  };
}

export function worksheetFile(worksheet: UserWorksheet): File {
  return new File(
    [JSON.stringify(worksheet, null, 2)],
    userLibraryWorksheetFileName(worksheet.title),
    { type: USER_LIBRARY_WORKSHEET_MIME_TYPE },
  );
}

export async function createUserWorksheet(
  draft: UserWorksheet = createUserWorksheetDraft(),
): Promise<StoredUserWorksheet> {
  const worksheet = withUpdatedAt(draft);
  await listUserLibraryFolders();
  const file = await addUserLibraryFile(
    worksheetFile(worksheet),
    USER_LIBRARY_WORKSHEETS_FOLDER_ID,
    undefined,
    { skipProcessing: true },
  );
  return { file, worksheet: { ...worksheet, title: file.title } };
}

/** «Сохранить свою версию» of a built-in (or a copy of one's own): a new file in the library. */
export function saveWorksheetCopy(source: UserWorksheet): Promise<StoredUserWorksheet> {
  return createUserWorksheet(copyWorksheet(source));
}

export async function loadUserWorksheet(fileId: string): Promise<StoredUserWorksheet> {
  const file = await getUserLibraryDocument(fileId);
  if (!file || !isUserLibraryWorksheet(file)) throw new Error('Дневник не найден.');
  const source = await getUserLibraryFile(fileId);
  if (!source) throw new Error('Файл дневника недоступен.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await source.text());
  } catch {
    throw new Error('Не удалось прочитать файл дневника.');
  }
  return { file, worksheet: { ...parseUserWorksheet(parsed), title: file.title } };
}

/** The doctor's sheets, the latest edited first; unreadable files are skipped. */
export async function listUserWorksheets(): Promise<readonly StoredUserWorksheet[]> {
  const files = (await listUserLibraryDocuments()).filter(isUserLibraryWorksheet);
  const loaded = await Promise.all(
    files.map((file) => loadUserWorksheet(file.id).catch(() => null)),
  );
  return loaded
    .filter((item): item is StoredUserWorksheet => item !== null)
    .toSorted((left, right) => right.worksheet.updatedAt.localeCompare(left.worksheet.updatedAt));
}

export async function saveUserWorksheet(
  fileId: string,
  draft: UserWorksheet,
): Promise<StoredUserWorksheet> {
  const worksheet = withUpdatedAt(draft);
  const file = await replaceUserLibraryFile(fileId, worksheetFile(worksheet), {
    folderId: USER_LIBRARY_WORKSHEETS_FOLDER_ID,
    skipProcessing: true,
  });
  if (!file) throw new Error('Дневник не найден.');
  return { file, worksheet: { ...worksheet, title: file.title } };
}

export async function deleteUserWorksheet(fileId: string): Promise<void> {
  await removeUserLibraryDocument(fileId);
}
