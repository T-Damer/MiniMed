import type { UserLibraryDocument } from '@/state/user-library';
import { userLibraryFileExtension } from '@/state/user-library-capabilities';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
}

const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(value: string | undefined): string {
  if (!value) return '';
  try {
    return DATE_FORMAT.format(new Date(value));
  } catch {
    return '';
  }
}

/** «PDF», «EPUB»…: tells apart two files that share a name and differ in format. */
export function userLibraryFormatLabel(fileName: string): string {
  const extension = userLibraryFileExtension(fileName);
  return extension ? extension.toLocaleUpperCase('ru-RU') : '';
}

/**
 * The card's status line as short parts. A phone card is narrow: the parts wrap as a whole, never
 * in the middle («Текстовый слой найден» / «PDF · 457 КБ · 07 окт., 02:10»).
 */
export function userLibraryStatusParts(
  document: UserLibraryDocument,
  activeOcrId: string | null,
): readonly string[] {
  if (document.status === 'inspecting') return ['Читаем файл…'];
  if (document.status === 'ready') {
    return [
      ...(document.hasTextLayer ? ['Текстовый слой найден'] : []),
      [
        userLibraryFormatLabel(document.fileName),
        formatFileSize(document.byteLength),
        formatDateTime(document.updatedAt),
      ]
        .filter(Boolean)
        .join(' · '),
    ];
  }
  if (document.status === 'failed') return [document.errorMessage || 'Не удалось обработать файл'];
  if (document.id !== activeOcrId) return ['В очереди на распознавание текста'];
  const done = document.nativeTextPages + document.ocrDonePages;
  return [`Распознавание текста · ${done} / ${document.pageCount}`];
}
