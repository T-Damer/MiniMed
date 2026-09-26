import type { ContentModuleCatalogEntry } from '@localmed/contracts';

const SETUP_DISMISSED_KEY = 'minimed:package-setup-dismissed:v1';
let dismissedInSession = false;

export function isSetupDismissed(): boolean {
  if (dismissedInSession) return true;
  try {
    return localStorage.getItem(SETUP_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissSetup(): void {
  dismissedInSession = true;
  try {
    localStorage.setItem(SETUP_DISMISSED_KEY, '1');
  } catch {
    /* Private browsing still retains the dismissal for this application session. */
  }
}

export function setupPackageGroups(modules: readonly ContentModuleCatalogEntry[]) {
  const kinds = [
    ['reference', 'Справочники и словари', 'Определения терминов и справочные материалы.'],
    ['clinical', 'Клинические рекомендации', 'Полные документы по нужным специальностям.'],
    ['medication', 'Лекарственные препараты', 'Лекарственные справочники и инструкции.'],
    ['tool', 'Шкалы и калькуляторы', 'Доступные опросники и расчёты.'],
    ['regulatory', 'Нормативные документы', 'Порядки и другие документы для работы.'],
    ['personal', 'Дополнительные материалы', 'Материалы для локальной работы.'],
  ] as const;
  return kinds
    .map(([kind, title, description]) => ({
      id: kind,
      title,
      description,
      modules: modules
        .filter(
          (module) => module.kind === kind && !module.required && module.releaseState !== 'bundled',
        )
        .toSorted(
          (a, b) =>
            Number(Boolean(b.definitionReference)) - Number(Boolean(a.definitionReference)) ||
            a.title.localeCompare(b.title, 'ru'),
        ),
    }))
    .filter((group) => group.modules.length > 0);
}

export function downloadPercent(
  loaded: number,
  total: number | null | undefined,
): number | undefined {
  if (!total || !Number.isFinite(total) || total < 0 || !Number.isFinite(loaded)) return undefined;
  return Math.min(100, Math.max(0, (loaded / total) * 100));
}
