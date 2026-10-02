/** Inline label of an edition link while its module downloads: «Скачиваем… 42 %». */
export function clinicalEditionDownloadLabel(progress: number | null): string {
  if (progress === null) return 'Скачиваем редакцию…';
  if (progress >= 1) return 'Подключаем редакцию…';
  return `Скачиваем редакцию… ${Math.min(99, Math.round(progress * 100))}%`;
}
