import { Capacitor } from '@capacitor/core';

import { RELEASE_VERSION } from '../../../../release';

export const APP_UPDATE_READY_EVENT = 'minimed:app-update-ready';

export interface AppUpdateReadyDetail {
  readonly worker: ServiceWorker;
}

export interface AppUpdateProgress {
  readonly phase: 'download' | 'verifying' | 'ready' | 'install' | 'activate';
  readonly loaded?: number;
  readonly total?: number | null;
}

export function formatAppUpdateLabel(
  updating: boolean,
  progress: AppUpdateProgress | undefined,
): string {
  if (!updating) return progress?.phase === 'ready' ? 'Установить' : 'Обновить';
  if (!progress || progress.phase === 'activate') return 'Активация…';
  if (progress.phase === 'install') return 'Открываем установщик…';
  if (progress.phase === 'verifying') return 'Проверяем файл…';
  if (progress.total && progress.total > 0) {
    const percent = Math.min(100, Math.round(((progress.loaded ?? 0) / progress.total) * 100));
    return `Загрузка ${percent}%`;
  }
  return 'Загрузка…';
}

export function formatAppUpdateCheckerStatus(input: {
  readonly version: string;
  readonly ready: boolean;
  readonly checking: boolean;
  readonly updating: boolean;
  readonly upToDate?: boolean;
  readonly dev?: boolean;
}): { readonly body: string; readonly checkLabel: string } {
  if (input.updating) {
    return { body: 'Загрузка обновления…', checkLabel: 'Проверить' };
  }
  if (input.checking) {
    return { body: 'Проверяем наличие обновления…', checkLabel: 'Проверка…' };
  }
  if (input.ready) {
    return { body: 'Доступна новая версия приложения.', checkLabel: 'Проверить ещё раз' };
  }
  if (input.upToDate) {
    return { body: 'Уже установлена последняя версия.', checkLabel: 'Проверить ещё раз' };
  }
  return {
    body: `Установлена версия ${input.version}.${input.dev ? ' DEV' : ''}`,
    checkLabel: 'Проверить обновления',
  };
}

interface GitHubReleasePayload {
  readonly tag_name?: unknown;
  readonly draft?: unknown;
  readonly assets?: unknown;
}

interface GitHubReleaseAsset {
  readonly browser_download_url?: unknown;
  readonly digest?: unknown;
  readonly size?: unknown;
}

function parseVersion(value: string): readonly [number, number, number] | null {
  const parts = value.replace(/^v/u, '').split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function compareVersions(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isGitHubReleaseAsset(value: unknown): value is GitHubReleaseAsset {
  return isRecord(value);
}

function optionalReleaseDigest(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return /^sha256:[a-f0-9]{64}$/u.test(normalized) ? normalized : undefined;
}

function optionalReleaseSize(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function releaseApk(release: GitHubReleasePayload): Omit<AvailableApkUpdate, 'version'> | null {
  if (release.draft === true || !Array.isArray(release.assets)) return null;
  const asset = release.assets.find((candidate) => {
    if (!isGitHubReleaseAsset(candidate)) return false;
    const url = candidate.browser_download_url;
    return typeof url === 'string' && url.toLowerCase().endsWith('.apk');
  });
  if (!isGitHubReleaseAsset(asset)) return null;
  const url = asset.browser_download_url;
  if (typeof url !== 'string') return null;
  const expectedSha256 = optionalReleaseDigest(asset.digest);
  const expectedBytes = optionalReleaseSize(asset.size);
  return {
    url,
    ...(expectedSha256 ? { expectedSha256 } : {}),
    ...(expectedBytes ? { expectedBytes } : {}),
  };
}

export interface AvailableApkUpdate {
  readonly version: string;
  readonly url: string;
  readonly expectedSha256?: string;
  readonly expectedBytes?: number;
}

export function appUpdateVersionFromWorker(
  worker: { readonly scriptURL?: string } | undefined,
): string | undefined {
  if (!worker) return undefined;
  const scriptURL = worker.scriptURL;
  if (!scriptURL) return 'pending';
  try {
    const version = new URL(scriptURL, 'https://localmed.invalid').searchParams.get('v');
    if (version?.trim()) return version.trim();
  } catch {
    return scriptURL;
  }
  return scriptURL;
}

export function selectLatestApkUpdate(
  releases: readonly GitHubReleasePayload[],
): AvailableApkUpdate | null {
  const current = parseVersion(RELEASE_VERSION);
  if (!current) return null;

  let selected:
    | ({
        readonly version: readonly [number, number, number];
        readonly label: string;
      } & Omit<AvailableApkUpdate, 'version'>)
    | null = null;
  for (const release of releases) {
    if (typeof release.tag_name !== 'string') continue;
    const version = parseVersion(release.tag_name);
    const apk = releaseApk(release);
    if (!version || !apk || compareVersions(version, current) <= 0) continue;
    if (!selected || compareVersions(version, selected.version) > 0) {
      selected = { version, label: release.tag_name.replace(/^v/u, ''), ...apk };
    }
  }
  return selected
    ? {
        version: selected.label,
        url: selected.url,
        ...(selected.expectedSha256 ? { expectedSha256: selected.expectedSha256 } : {}),
        ...(selected.expectedBytes ? { expectedBytes: selected.expectedBytes } : {}),
      }
    : null;
}

export async function checkNativeApkUpdate(): Promise<AvailableApkUpdate | null> {
  if (Capacitor.getPlatform() !== 'android' || !navigator.onLine) return null;
  const response = await fetch(
    'https://api.github.com/repos/T-Damer/MiniMed/releases?per_page=20',
    {
      headers: { Accept: 'application/vnd.github+json' },
    },
  );
  if (!response.ok) return null;
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) return null;
  return selectLatestApkUpdate(payload.filter(isRecord));
}

function announceUpdate(worker: ServiceWorker): void {
  if (!navigator.serviceWorker.controller) return;
  window.dispatchEvent(
    new CustomEvent<AppUpdateReadyDetail>(APP_UPDATE_READY_EVENT, { detail: { worker } }),
  );
}

/** A tab kept open for days looks for a new build when it is shown again, at most this often. */
export const APP_UPDATE_RECHECK_MS = 15 * 60_000;

interface UpdateCheckTarget {
  readonly update: () => Promise<unknown>;
}

interface UpdateCheckPage {
  readonly visible: () => boolean;
  readonly now: () => number;
  /** Subscribes to «the page was shown» and «the network came back»; returns the unsubscribe. */
  readonly onWake: (wake: () => void) => () => void;
}

function browserUpdateCheckPage(): UpdateCheckPage {
  return {
    visible: () => document.visibilityState === 'visible',
    now: () => Date.now(),
    onWake: (wake) => {
      document.addEventListener('visibilitychange', wake);
      window.addEventListener('online', wake);
      return () => {
        document.removeEventListener('visibilitychange', wake);
        window.removeEventListener('online', wake);
      };
    },
  };
}

/**
 * Asks the server for a new service worker when the page is shown or the network returns, at most
 * every {@link APP_UPDATE_RECHECK_MS}. A found update installs in the background and is announced
 * through the usual `statechange`; nothing here reloads the page.
 */
export function watchForAppUpdates(
  registration: UpdateCheckTarget,
  page: UpdateCheckPage = browserUpdateCheckPage(),
  minIntervalMs: number = APP_UPDATE_RECHECK_MS,
): () => void {
  let lastCheck = page.now();
  return page.onWake(() => {
    if (!page.visible() || page.now() - lastCheck < minIntervalMs) return;
    lastCheck = page.now();
    registration.update().catch((cause: unknown) => {
      // Offline or the host is unreachable: the next wake-up tries again.
      console.debug('Проверка обновления приложения не удалась.', cause);
    });
  });
}

export async function registerAppServiceWorker(): Promise<void> {
  if (Capacitor.getPlatform() !== 'web') return;
  const registration = await navigator.serviceWorker.register(`./sw.js?v=${RELEASE_VERSION}`);
  if (registration.waiting) announceUpdate(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') announceUpdate(worker);
    });
  });
  watchForAppUpdates(registration);
}

export function activateAppUpdate(
  worker: Pick<ServiceWorker, 'postMessage'>,
  serviceWorkers: Pick<ServiceWorkerContainer, 'addEventListener'> = navigator.serviceWorker,
  reload: () => void = () => window.location.reload(),
): void {
  serviceWorkers.addEventListener('controllerchange', reload, { once: true });
  worker.postMessage({ type: 'SKIP_WAITING' });
}

/** Installing a build means downloading its whole shell; a check waits this long for it. */
export const APP_UPDATE_INSTALL_WAIT_MS = 30_000;

interface InstallingWorker {
  readonly state: ServiceWorkerState;
  addEventListener(type: 'statechange', listener: () => void): void;
  removeEventListener(type: 'statechange', listener: () => void): void;
}

/** Resolves when the worker has installed (or failed), or after `timeoutMs`. */
export function waitForWorkerInstalled(
  worker: InstallingWorker,
  timeoutMs: number = APP_UPDATE_INSTALL_WAIT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', onChange);
      resolve();
    };
    const onChange = (): void => {
      if (worker.state !== 'installing') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    worker.addEventListener('statechange', onChange);
    onChange();
  });
}

export async function checkWebAppUpdate(
  getRegistration: () => Promise<ServiceWorkerRegistration | undefined> = () =>
    navigator.serviceWorker.getRegistration(),
  dispatchReady: (worker: ServiceWorker) => void = announceUpdate,
  waitInstalled: typeof waitForWorkerInstalled = waitForWorkerInstalled,
): Promise<boolean> {
  const registration = await getRegistration();
  if (!registration) return false;
  await registration.update();
  // `update()` resolves once the new worker has started installing, not when it is ready.
  if (!registration.waiting && registration.installing) {
    await waitInstalled(registration.installing);
  }
  if (!registration.waiting) return false;
  dispatchReady(registration.waiting);
  return true;
}
