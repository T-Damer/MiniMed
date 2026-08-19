import type { ContentModuleCatalogEntry, ContentModuleDownloadTask } from '@localmed/contracts';

import { documentCountLabel } from '@/i18n/labels';

export const MODULE_RELEASE_LABELS: Readonly<
  Record<ContentModuleCatalogEntry['releaseState'], string>
> = {
  bundled: 'Уже в приложении',
  published: 'Можно скачать',
  preview: 'Experimental',
  planned: 'Запланировано',
};

export const MODULE_TASK_LABELS: Readonly<Record<ContentModuleDownloadTask['state'], string>> = {
  queued: 'В очереди',
  downloading: 'Скачивается',
  verifying: 'Проверяется',
  installing: 'Устанавливается',
  completed: 'Установлено',
  failed: 'Ошибка установки',
  cancelled: 'Загрузка отменена',
};

export function formatModuleBytes(value: number | null): string {
  if (value === null) return 'размер пока не указан';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} КБ`;
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} МБ`;
}

export type ModuleCollectionSubtitleVariant = 'default' | 'core';

export interface ModuleCollectionSubtitleOptions {
  readonly variant?: ModuleCollectionSubtitleVariant;
}

export interface OverviewCollectionSubtitleInput {
  readonly documentCountLabel?: string | null;
  readonly downloadBytes: number;
  readonly installedBytes: number;
}

function formatKnownBytes(bytes: number): string | null {
  if (bytes <= 0) return null;
  return formatModuleBytes(bytes);
}

export function formatModuleCollectionSubtitle(
  installedCount: number,
  moduleCount: number,
  downloadBytes: number,
  installedBytes: number,
  options?: ModuleCollectionSubtitleOptions,
): string | null {
  const variant = options?.variant ?? 'default';

  if (variant === 'core') {
    if (installedCount > 0) {
      return formatKnownBytes(installedBytes);
    }
    return formatKnownBytes(downloadBytes);
  }

  const fullyInstalled = moduleCount > 0 && installedCount > 0 && installedCount === moduleCount;
  const nothingInstalled = installedCount === 0;
  const segments: string[] = [];

  if (moduleCount > 0 && !fullyInstalled) {
    segments.push(`${installedCount}/${moduleCount}`);
  }

  if (nothingInstalled) {
    const downloadLabel = formatKnownBytes(downloadBytes);
    if (downloadLabel) segments.push(downloadLabel);
  } else if (fullyInstalled) {
    const installedLabel = formatKnownBytes(installedBytes);
    const catalogLabel = formatKnownBytes(downloadBytes);
    if (installedLabel && catalogLabel && installedLabel === catalogLabel) {
      segments.push(installedLabel);
    } else if (installedLabel) {
      segments.push(installedLabel);
    } else if (catalogLabel) {
      segments.push(catalogLabel);
    }
  } else {
    const installedLabel = formatKnownBytes(installedBytes);
    const catalogLabel = formatKnownBytes(downloadBytes);
    if (installedLabel) {
      segments.push(`загружено ${installedLabel}`);
    }
    if (catalogLabel && catalogLabel !== installedLabel) {
      segments.push(catalogLabel);
    }
  }

  if (segments.length === 0) return null;
  return segments.join(' · ');
}

export function formatOverviewCollectionSubtitle(
  input: OverviewCollectionSubtitleInput,
): string | null {
  const size = formatKnownBytes(input.installedBytes) ?? formatKnownBytes(input.downloadBytes);
  const countLabel = input.documentCountLabel?.trim() || null;
  const segments = [countLabel, size].filter((segment): segment is string => Boolean(segment));
  if (segments.length === 0) return null;
  return segments.join(' · ');
}

export function contentModuleTaskProgress(task: ContentModuleDownloadTask): number | null {
  if (!task.totalBytes || task.totalBytes <= 0) return null;
  return Math.max(0, Math.min(1, task.downloadedBytes / task.totalBytes));
}

export function formatFullTextDownloadLabel(
  pending: boolean,
  progress: number | null,
  hasFullText: boolean,
): string {
  if (!pending) return hasFullText ? 'Полный текст' : 'Загрузить полный текст';
  if (progress !== null) return `${Math.min(100, Math.round(progress * 100))}%`;
  return 'Загружаем полную версию…';
}

export function primaryModuleDocumentId(module: ContentModuleCatalogEntry): string | null {
  const activeDocument = module.documents.find((document) => document.status === 'active');
  return activeDocument?.documentId ?? module.documents[0]?.documentId ?? null;
}

export function moduleListedDocumentCount(module: ContentModuleCatalogEntry): number {
  return Math.max(module.previewDocumentCount ?? 0, module.documents.length);
}

export function moduleDocumentCountFact(module: ContentModuleCatalogEntry): string {
  const count = moduleListedDocumentCount(module);
  return count > 0 ? documentCountLabel(count) : 'Список документов уточняется';
}
