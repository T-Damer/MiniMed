import { type ErrorStates, err, ok, type TypedResult } from '@localmed/contracts';

import { userLibraryFileKind } from '@/state/user-library';
import type { UserLibraryFileKind } from '@/state/user-library-capabilities';

/**
 * «Мой компьютер» in «Файлы» (owner 2026-11-11): a folder of the device's own files, read in place.
 * Where the browser has the File System Access API (desktop Chrome, Edge), the doctor picks a
 * folder once; its handle is kept in IndexedDB and the folder is listed live, with read access
 * asked again after a restart (the browser decides). Elsewhere (Android WebView, Safari, Firefox)
 * the system file picker stands in (`ComputerFolderView`). Nothing here uploads anything.
 */

export interface ComputerEntry {
  readonly name: string;
  readonly kind: 'folder' | 'file';
  readonly fileKind?: UserLibraryFileKind;
  readonly size?: number;
  readonly modified?: number;
  readonly handle: FileSystemHandle;
}

export type ComputerFolderFailure =
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'unreadable'; readonly message: string };

/** What the doctor sees for each failure (docs/ERRORS.md). */
export const COMPUTER_FOLDER_FAILURE_STATES: ErrorStates<ComputerFolderFailure> = {
  unsupported: {
    title: 'Браузер не даёт открыть папку',
    text: 'Файлы можно выбрать по одному.',
  },
  cancelled: { title: 'Папка не выбрана', text: 'Выберите её, когда понадобится.' },
  denied: { title: 'Нет доступа к папке', text: 'Разрешите доступ, чтобы увидеть файлы.' },
  gone: { title: 'Папка больше недоступна', text: 'Её переместили или удалили. Выберите другую.' },
  unreadable: { title: 'Папку не удалось прочитать', text: 'Повторите или выберите другую.' },
};

interface DirectoryPickerWindow {
  showDirectoryPicker?: (options?: {
    readonly mode?: 'read' | 'readwrite';
    readonly id?: string;
  }) => Promise<FileSystemDirectoryHandle>;
}

interface PermissionHandle {
  queryPermission?: (descriptor: { readonly mode: 'read' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { readonly mode: 'read' }) => Promise<PermissionState>;
}

export function computerFolderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function' &&
    typeof indexedDB !== 'undefined'
  );
}

const DATABASE = 'minimed-computer-folder';
const STORE = 'handles';
const KEY = 'root';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable.'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    });
  } finally {
    database.close();
  }
}

/** The folder chosen before, if any (its access may need asking again). */
export async function savedComputerFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  if (!computerFolderSupported()) return undefined;
  const value = await withStore<unknown>('readonly', (store) => store.get(KEY));
  return value instanceof FileSystemDirectoryHandle ? value : undefined;
}

export async function forgetComputerFolder(): Promise<void> {
  if (!computerFolderSupported()) return;
  await withStore('readwrite', (store) => store.delete(KEY));
}

function failureOf(cause: unknown): ComputerFolderFailure {
  if (cause instanceof DOMException) {
    if (cause.name === 'AbortError') return { kind: 'cancelled' };
    if (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
      return { kind: 'denied' };
    if (cause.name === 'NotFoundError') return { kind: 'gone' };
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  console.warn('The computer folder could not be read.', cause);
  return { kind: 'unreadable', message };
}

/** Asks the browser to pick a folder (a tap must lead here) and remembers it. */
export async function pickComputerFolder(): Promise<
  TypedResult<FileSystemDirectoryHandle, ComputerFolderFailure>
> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker || !computerFolderSupported()) return err({ kind: 'unsupported' });
  try {
    const handle = await picker.call(window, { mode: 'read', id: 'minimed-computer' });
    await withStore('readwrite', (store) => store.put(handle, KEY));
    return ok(handle);
  } catch (cause) {
    return err(failureOf(cause));
  }
}

/** Read access to a remembered folder: `prompt` needs a tap (`requestComputerFolderAccess`). */
export async function computerFolderAccess(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  const query = (handle as unknown as PermissionHandle).queryPermission;
  return query ? query.call(handle, { mode: 'read' }) : 'granted';
}

export async function requestComputerFolderAccess(
  handle: FileSystemDirectoryHandle,
): Promise<TypedResult<true, ComputerFolderFailure>> {
  const request = (handle as unknown as PermissionHandle).requestPermission;
  try {
    const state = request ? await request.call(handle, { mode: 'read' }) : 'granted';
    return state === 'granted' ? ok(true) : err({ kind: 'denied' });
  } catch (cause) {
    return err(failureOf(cause));
  }
}

/** Folders first, then files, each by name; hidden files (a leading dot) are left out. */
export async function listComputerFolder(
  folder: FileSystemDirectoryHandle,
): Promise<TypedResult<readonly ComputerEntry[], ComputerFolderFailure>> {
  try {
    const entries: ComputerEntry[] = [];
    for await (const handle of (
      folder as unknown as { values(): AsyncIterable<FileSystemHandle> }
    ).values()) {
      if (handle.name.startsWith('.')) continue;
      if (handle.kind === 'directory') {
        entries.push({ name: handle.name, kind: 'folder', handle });
        continue;
      }
      const file = await (handle as FileSystemFileHandle).getFile();
      entries.push({
        name: handle.name,
        kind: 'file',
        fileKind: userLibraryFileKind(file.type, file.name),
        size: file.size,
        modified: file.lastModified,
        handle,
      });
    }
    return ok(sortComputerEntries(entries));
  } catch (cause) {
    return err(failureOf(cause));
  }
}

export function sortComputerEntries<T extends Pick<ComputerEntry, 'name' | 'kind'>>(
  entries: readonly T[],
): T[] {
  return entries.toSorted(
    (left, right) =>
      (left.kind === right.kind ? 0 : left.kind === 'folder' ? -1 : 1) ||
      left.name.localeCompare(right.name, 'ru', { numeric: true, sensitivity: 'base' }),
  );
}

export async function readComputerFile(
  entry: ComputerEntry,
): Promise<TypedResult<File, ComputerFolderFailure>> {
  try {
    return ok(await (entry.handle as FileSystemFileHandle).getFile());
  } catch (cause) {
    return err(failureOf(cause));
  }
}
