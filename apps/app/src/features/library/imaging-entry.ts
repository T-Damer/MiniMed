import { createSignal, onCleanup, onMount } from 'solid-js';

import { openUserLibraryDocument } from '@/features/library/user-library-routing';
import {
  addUserLibraryFile,
  isUserLibraryMedicalImageFile,
  listUserLibraryDocuments,
  listUserLibraryFolders,
  USER_LIBRARY_EVENT,
  USER_LIBRARY_RESEARCH_FOLDER_ID,
  type UserLibraryDocument,
  type UserLibraryExampleId,
} from '@/state/user-library';

/** A study the viewer can open: DICOM or NIfTI in «Мои файлы», newest first. */
export function selectImagingStudies(
  documents: readonly UserLibraryDocument[],
): readonly UserLibraryDocument[] {
  return documents
    .filter((document) => isUserLibraryMedicalImageFile(document.mimeType, document.fileName))
    .toSorted((left, right) =>
      (right.lastOpenedAt ?? right.updatedAt).localeCompare(left.lastOpenedAt ?? left.updatedAt),
    );
}

/** The library copy of a built-in example (by slot, or by its file name), if one is there. */
export function findExampleStudy(
  documents: readonly UserLibraryDocument[],
  exampleId: UserLibraryExampleId,
  fileName: string,
): UserLibraryDocument | undefined {
  return documents.find(
    (document) => document.exampleId === exampleId || document.fileName === fileName,
  );
}

/** Why a dropped or picked file cannot go to the viewer; undefined when it can. */
export function imagingFileProblem(file: Pick<File, 'name' | 'type'>): string | undefined {
  return isUserLibraryMedicalImageFile(file.type, file.name)
    ? undefined
    : `«${file.name}» не похож на снимок: просмотр открывает DICOM и NIfTI (.dcm, .nii, .nii.gz).`;
}

/** Imports through the user library into «Исследования» and returns the stored study. */
export async function importImagingFile(file: File): Promise<UserLibraryDocument> {
  const problem = imagingFileProblem(file);
  if (problem) throw new Error(problem);
  // Seeds the default folders, so «Исследования» exists before the file goes into it.
  await listUserLibraryFolders();
  return addUserLibraryFile(file, USER_LIBRARY_RESEARCH_FOLDER_ID);
}

export function openImagingStudy(document: Pick<UserLibraryDocument, 'id' | 'title'>): void {
  openUserLibraryDocument({ documentId: document.id, title: document.title });
}

/** Imports the first dropped or picked file and opens it; returns the problem text on failure. */
export async function importAndOpenImagingFiles(
  files: readonly File[],
): Promise<string | undefined> {
  const file = files[0];
  if (!file) return undefined;
  try {
    openImagingStudy(await importImagingFile(file));
    return undefined;
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'Не удалось добавить снимок.';
  }
}

/** True when a drag carries files (not text or a link), so a drop target can light up. */
export function dragCarriesFiles(transfer: DataTransfer | null): boolean {
  return Boolean(transfer && Array.from(transfer.types).includes('Files'));
}

/** The user's library documents, kept in step with the library (filter with selectImagingStudies). */
export function createUserLibraryDocuments(): () => readonly UserLibraryDocument[] {
  const [documents, setDocuments] = createSignal<readonly UserLibraryDocument[]>([]);
  const refresh = (): void => {
    void listUserLibraryDocuments().then(setDocuments, () => setDocuments([]));
  };
  onMount(() => {
    refresh();
    window.addEventListener(USER_LIBRARY_EVENT, refresh);
    onCleanup(() => window.removeEventListener(USER_LIBRARY_EVENT, refresh));
  });
  return documents;
}
