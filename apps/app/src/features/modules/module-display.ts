import type { ContentModuleCatalogEntry, ContentModuleDownloadTask } from '@localmed/contracts';

export const MODULE_RELEASE_LABELS: Readonly<
  Record<ContentModuleCatalogEntry['releaseState'], string>
> = {
  bundled: 'Уже в приложении',
  published: 'Можно скачать',
  preview: 'Готовится',
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

export function contentModuleTaskProgress(task: ContentModuleDownloadTask): number | null {
  if (!task.totalBytes || task.totalBytes <= 0) return null;
  return Math.max(0, Math.min(1, task.downloadedBytes / task.totalBytes));
}

export function primaryModuleDocumentId(module: ContentModuleCatalogEntry): string | null {
  const activeDocument = module.documents.find((document) => document.status === 'active');
  return activeDocument?.documentId ?? module.documents[0]?.documentId ?? null;
}
