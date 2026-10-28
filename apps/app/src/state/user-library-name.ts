/** Name rules shared by the user library and the light-weight questionnaire format. */
export const USER_LIBRARY_NAME_MAX_LENGTH = 256;

export function normalizeUserLibraryName(value: string, kind: 'file' | 'folder'): string {
  const trimmed = value.trim();
  if (!trimmed)
    throw new Error(kind === 'folder' ? 'Введите название папки.' : 'Имя файла пустое.');
  if ([...trimmed].length > USER_LIBRARY_NAME_MAX_LENGTH) {
    throw new Error(
      `${kind === 'folder' ? 'Название папки' : 'Имя файла'} не должно быть длиннее ${USER_LIBRARY_NAME_MAX_LENGTH} символов.`,
    );
  }
  if (trimmed.includes('\u0000') || /[\\/]/u.test(trimmed)) {
    throw new Error(
      `${kind === 'folder' ? 'Название папки' : 'Имя файла'} содержит недопустимый символ.`,
    );
  }
  return trimmed;
}
