import type { DownloadPhase } from '@/features/downloads/download-queue';
import { pluralRu } from '@/i18n/labels';
import type { ClinicianProfile } from '@/state/clinician-profile';
import type { SettingsPageId } from './settings-pages';

type EcgPackageState = 'missing' | 'partial' | 'outdated' | 'installed';

/**
 * Statuses on the right of the settings list. Every function is pure: it turns state that already
 * lives in a store (download queue, model caches, preferences) into a label and a tone, so nothing
 * is stored twice and each status is covered by a unit test.
 */
export type SettingsStatusTone = 'ok' | 'attention' | 'working' | 'neutral';

export interface SettingsStatus {
  readonly label: string;
  readonly tone: SettingsStatusTone;
}

export type SettingsStatuses = Readonly<Record<SettingsPageId, SettingsStatus>>;

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** «1,2 ГБ», «286 МБ», «4,8 МБ»: a size with a decimal comma. */
export function formatStorageSize(bytes: number): string {
  const decimal = (value: number): string => value.toFixed(1).replace('.', ',');
  if (bytes >= GIB) return `${decimal(bytes / GIB)} ГБ`;
  const megabytes = bytes / MIB;
  return `${megabytes >= 10 ? String(Math.round(megabytes)) : decimal(megabytes)} МБ`;
}

export interface GeneralStatusInput {
  readonly version: string;
  readonly updateReady: boolean;
  readonly updating: boolean;
  readonly checking: boolean;
  readonly upToDate: boolean;
}

export function generalStatus(input: GeneralStatusInput): SettingsStatus {
  if (input.updating) return { label: 'Обновляется…', tone: 'working' };
  if (input.updateReady) return { label: 'Есть обновление', tone: 'attention' };
  if (input.checking) return { label: 'Проверяем…', tone: 'working' };
  if (input.upToDate) return { label: 'Актуальная версия', tone: 'ok' };
  return { label: `Версия ${input.version}`, tone: 'neutral' };
}

const CLINICIAN_FIELDS = [
  'organizationName',
  'organizationAddress',
  'ogrn',
  'clinicianFullName',
  'clinicianPosition',
] as const satisfies readonly (keyof ClinicianProfile)[];

export function clinicianStatus(profile: ClinicianProfile): SettingsStatus {
  const filled = CLINICIAN_FIELDS.filter((key) => (profile[key] ?? '').trim() !== '').length;
  if (filled === 0) return { label: 'Не заполнено', tone: 'neutral' };
  if (filled === CLINICIAN_FIELDS.length) return { label: 'Заполнено', tone: 'ok' };
  return { label: `Заполнено ${filled} из ${CLINICIAN_FIELDS.length}`, tone: 'attention' };
}

const RUNNING_PHASES: ReadonlySet<DownloadPhase> = new Set([
  'downloading',
  'verifying',
  'installing',
  'cancelling',
]);
const WAITING_PHASES: ReadonlySet<DownloadPhase> = new Set(['queued', 'retrying']);
const ATTENTION_PHASES: ReadonlySet<DownloadPhase> = new Set(['failed', 'interrupted']);

export interface DownloadQueueCounts {
  readonly active: number;
  readonly queued: number;
  readonly attention: number;
}

/** The same grouping the download manager shows: running, waiting and needing a retry. */
export function downloadQueueCounts(
  tasks: readonly { readonly state: DownloadPhase }[],
): DownloadQueueCounts {
  return {
    active: tasks.filter((task) => RUNNING_PHASES.has(task.state)).length,
    queued: tasks.filter((task) => WAITING_PHASES.has(task.state)).length,
    attention: tasks.filter((task) => ATTENTION_PHASES.has(task.state)).length,
  };
}

export interface DownloadsStatusInput {
  /** Transfers running now (downloading, verifying, installing). */
  readonly active: number;
  readonly queued: number;
  /** Failed or interrupted transfers waiting for a retry. */
  readonly attention: number;
  /** Sections whose every package is installed; undefined until the release catalog is loaded. */
  readonly installedSections: number | undefined;
  /** Bytes of the installed packages; undefined until the release catalog is loaded. */
  readonly installedBytes: number | undefined;
}

const SECTION_FORMS = ['раздел', 'раздела', 'разделов'] as const;

export function downloadsStatus(input: DownloadsStatusInput): SettingsStatus {
  if (input.active > 0) {
    return {
      label: `Скачивается · ${input.active + input.queued}`,
      tone: 'working',
    };
  }
  if (input.queued > 0) return { label: `В очереди · ${input.queued}`, tone: 'working' };
  if (input.attention > 0) {
    return {
      label: `${input.attention} ${pluralRu(input.attention, 'требует', 'требуют', 'требуют')} внимания`,
      tone: 'attention',
    };
  }
  if (input.installedSections === undefined) return { label: 'Проверяем…', tone: 'neutral' };
  if (input.installedSections === 0) return { label: 'Не скачано', tone: 'neutral' };
  const sections = `${input.installedSections} ${pluralRu(input.installedSections, ...SECTION_FORMS)}`;
  const size = input.installedBytes ? ` · ${formatStorageSize(input.installedBytes)}` : '';
  return { label: `${sections}${size}`, tone: 'ok' };
}

/** What one optional on-device capability is doing; the three AI cards map onto it. */
export type FeatureReadiness = 'checking' | 'missing' | 'working' | 'update' | 'ready';

export function e5Readiness(
  installed: boolean | undefined,
  downloading: boolean,
): FeatureReadiness {
  if (downloading) return 'working';
  if (installed === undefined) return 'checking';
  return installed ? 'ready' : 'missing';
}

/** Speech recognition is ready once a model is chosen and stored on the device; «off» counts as not set up. */
export function asrReadiness(
  selectedModel: string | null,
  modelOnDevice: boolean,
  downloading: boolean,
): FeatureReadiness {
  if (downloading) return 'working';
  return selectedModel !== null && modelOnDevice ? 'ready' : 'missing';
}

/** The OCR language pack is a single stored pack: on the device or not. */
export function ocrReadiness(installed: boolean, downloading: boolean): FeatureReadiness {
  if (downloading) return 'working';
  return installed ? 'ready' : 'missing';
}

export function ecgReadiness(state: EcgPackageState, downloading: boolean): FeatureReadiness {
  if (downloading) return 'working';
  if (state === 'installed') return 'ready';
  return state === 'outdated' ? 'update' : 'missing';
}

export function aiStatus(features: readonly FeatureReadiness[]): SettingsStatus {
  const total = features.length;
  const ready = features.filter((state) => state === 'ready' || state === 'update').length;
  if (features.includes('working')) return { label: 'Скачивается…', tone: 'working' };
  if (features.includes('checking')) return { label: 'Проверяем…', tone: 'neutral' };
  if (features.includes('update')) return { label: 'Есть обновление', tone: 'attention' };
  if (ready === 0) return { label: 'Не скачано', tone: 'neutral' };
  if (ready === total) return { label: 'Готово', tone: 'ok' };
  return { label: `Готово ${ready} из ${total}`, tone: 'ok' };
}

export interface ReferenceImagesStatusInput {
  readonly files: number;
  readonly totalFiles: number;
  readonly totalBytes: number;
  readonly complete: boolean;
}

export interface ReferenceImagesStatusContext {
  /** Undefined while the cache is still being read. */
  readonly status: ReferenceImagesStatusInput | undefined;
  readonly downloading: boolean;
  /** Download progress, 0–1, when known. */
  readonly fraction: number | null;
}

export function referenceImagesStatus(context: ReferenceImagesStatusContext): SettingsStatus {
  if (context.downloading) {
    return {
      label:
        context.fraction === null
          ? 'Скачивается…'
          : `Скачивается · ${String(Math.floor(context.fraction * 100))}%`,
      tone: 'working',
    };
  }
  const known = context.status;
  if (!known) return { label: 'Проверяем…', tone: 'neutral' };
  if (known.complete) return { label: 'Готово', tone: 'ok' };
  if (known.files > 0) {
    return { label: `Скачано ${known.files} из ${known.totalFiles}`, tone: 'attention' };
  }
  return { label: 'Не скачано', tone: 'neutral' };
}

export type ColorScheme = 'light' | 'dark';

/** The theme follows the device; the status names the one in effect. */
export function appearanceStatus(scheme: ColorScheme): SettingsStatus {
  return { label: scheme === 'dark' ? 'Тёмная' : 'Светлая', tone: 'neutral' };
}

export type PatientVaultState = 'checking' | 'empty' | 'native-keychain' | 'unencrypted';

export function dataStatus(state: PatientVaultState): SettingsStatus {
  switch (state) {
    case 'checking':
      return { label: 'Проверяем…', tone: 'neutral' };
    case 'empty':
      return { label: 'Пусто', tone: 'neutral' };
    case 'native-keychain':
      return { label: 'Защищено', tone: 'ok' };
    case 'unencrypted':
      return { label: 'Без шифрования', tone: 'attention' };
  }
}

export function aboutStatus(version: string): SettingsStatus {
  return { label: `v${version}`, tone: 'neutral' };
}

/** What the card says about where patient cards are kept; pure so it can be tested. */
export function patientStorageDescription(state: PatientVaultState): string {
  switch (state) {
    case 'checking':
      return 'Проверяем хранилище пациентов…';
    case 'empty':
      return 'Карточек пациентов пока нет. Карточка создаётся в разделе заметок и остаётся на этом устройстве.';
    case 'native-keychain':
      return 'Карточки пациентов зашифрованы ключом этого устройства и никуда не отправляются.';
    case 'unencrypted':
      return 'Карточки пациентов лежат на этом устройстве без шифрования: защищённое хранилище ключей здесь недоступно. Никуда не отправляются.';
  }
}
