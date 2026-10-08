import type { DrugDownloadState } from '@/features/medications/use-drug-download';
import { formatModuleBytes } from '@/features/modules/module-display';
import { LARGE_DOWNLOAD_BYTES } from '@/features/onboarding/onboarding-downloads';

export const MEDICATION_DOWNLOAD_EXPLANATION =
  'Реестр ЕСКЛП, инструкции ГРЛС и Allmed: по группам АТХ или целиком.';

/** «Скачать препараты · 286 МБ»: the size is the whole set, whatever is already installed. */
export function medicationDownloadLabel(input: {
  readonly state: DrugDownloadState | undefined;
  readonly failed: boolean;
  readonly problem: boolean;
  readonly active: boolean;
}): string {
  const { state } = input;
  if (input.failed) return 'Список пакетов не загрузился';
  if (!state) return 'Считаем размер…';
  if (state.modules.length === 0) return 'Пока недоступно';
  if (input.active) {
    const fraction = state.progress.byteProgress;
    return fraction === null
      ? 'Скачиваем препараты…'
      : `Скачиваем препараты · ${Math.floor(fraction * 100)} %`;
  }
  if (state.plan.complete) return 'Препараты скачаны';
  const size = state.totalBytes === null ? '' : ` · ${formatModuleBytes(state.totalBytes)}`;
  return `${input.problem ? 'Повторить' : 'Скачать препараты'}${size}`;
}

export function medicationDownloadDisabled(input: {
  readonly state: DrugDownloadState | undefined;
  readonly active: boolean;
}): boolean {
  const { state } = input;
  return !state || state.modules.length === 0 || state.plan.complete || input.active;
}

/** Big sets get a «лучше по Wi‑Fi» hint before the download starts. */
export function medicationDownloadIsLarge(state: DrugDownloadState | undefined): boolean {
  return (state?.plan.bytes ?? 0) >= LARGE_DOWNLOAD_BYTES;
}
