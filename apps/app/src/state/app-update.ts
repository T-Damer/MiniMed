import { Capacitor } from '@capacitor/core';

import { RELEASE_VERSION } from '../../../../release';

export const APP_UPDATE_READY_EVENT = 'minimed:app-update-ready';

export interface AppUpdateReadyDetail {
  readonly worker: ServiceWorker;
}

interface GitHubReleasePayload {
  readonly tag_name?: unknown;
  readonly draft?: unknown;
  readonly assets?: unknown;
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

function releaseApkUrl(release: GitHubReleasePayload): string | null {
  if (release.draft === true || !Array.isArray(release.assets)) return null;
  const asset = release.assets.find((candidate) => {
    if (!isRecord(candidate)) return false;
    const url = candidate['browser_download_url'];
    return typeof url === 'string' && url.toLowerCase().endsWith('.apk');
  });
  if (!isRecord(asset)) return null;
  const url = asset['browser_download_url'];
  return typeof url === 'string' ? url : null;
}

export function selectLatestApkUpdate(releases: readonly GitHubReleasePayload[]): string | null {
  const current = parseVersion(RELEASE_VERSION);
  if (!current) return null;

  let selected: {
    readonly version: readonly [number, number, number];
    readonly url: string;
  } | null = null;
  for (const release of releases) {
    if (typeof release.tag_name !== 'string') continue;
    const version = parseVersion(release.tag_name);
    const url = releaseApkUrl(release);
    if (!version || !url || compareVersions(version, current) <= 0) continue;
    if (!selected || compareVersions(version, selected.version) > 0) {
      selected = { version, url };
    }
  }
  return selected?.url ?? null;
}

export async function checkNativeApkUpdate(): Promise<string | null> {
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

export async function registerAppServiceWorker(): Promise<void> {
  const registration = await navigator.serviceWorker.register(`./sw.js?v=${RELEASE_VERSION}`);
  if (registration.waiting) announceUpdate(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') announceUpdate(worker);
    });
  });
}

export function activateAppUpdate(
  worker: Pick<ServiceWorker, 'postMessage'>,
  serviceWorkers: Pick<ServiceWorkerContainer, 'addEventListener'> = navigator.serviceWorker,
  reload: () => void = () => window.location.reload(),
): void {
  serviceWorkers.addEventListener('controllerchange', reload, { once: true });
  worker.postMessage({ type: 'SKIP_WAITING' });
}
