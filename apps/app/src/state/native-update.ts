import { type PluginListenerHandle, registerPlugin } from '@capacitor/core';

export type ApkTaskState = 'downloading' | 'verifying' | 'ready' | 'failed' | 'cancelled';

export interface ApkDownloadRequest {
  readonly url: string;
  readonly releaseVersion?: string;
  readonly expectedSha256?: string;
  readonly expectedBytes?: number;
}

export interface ApkTaskStatus {
  readonly taskId: string;
  readonly state: ApkTaskState;
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
  readonly errorCode: string | null;
  /** True until the native stream has closed, even if its public state is terminal. */
  readonly transportActive: boolean;
}

export interface LocalMedUpdatePlugin {
  startApkDownload(options: ApkDownloadRequest): Promise<{ readonly taskId: string }>;
  getApkDownloadStatus(options: { readonly taskId: string }): Promise<ApkTaskStatus>;
  getLatestApkDownloadStatus(
    options: ApkDownloadRequest,
  ): Promise<{ readonly status: ApkTaskStatus | null }>;
  cancelApkDownload(options: { readonly taskId: string }): Promise<void>;
  installDownloadedApk(options: { readonly taskId: string }): Promise<void>;
  addListener(
    eventName: 'apkDownloadProgress',
    listenerFunc: (status: ApkTaskStatus) => void,
  ): Promise<PluginListenerHandle>;
}

const localMedUpdate = registerPlugin<LocalMedUpdatePlugin>('LocalMedUpdate');

export function assertHttpsApkUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Only HTTPS APK URLs are allowed.');
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error('Only HTTPS APK URLs are allowed.');
  }
}

export async function startAndroidApkDownload(
  request: ApkDownloadRequest,
  plugin: Pick<LocalMedUpdatePlugin, 'startApkDownload'> = localMedUpdate,
): Promise<{ readonly taskId: string }> {
  assertHttpsApkUrl(request.url);
  return plugin.startApkDownload(request);
}

export function getAndroidApkTaskStatus(
  taskId: string,
  plugin: Pick<LocalMedUpdatePlugin, 'getApkDownloadStatus'> = localMedUpdate,
): Promise<ApkTaskStatus> {
  return plugin.getApkDownloadStatus({ taskId });
}

export async function getLatestAndroidApkTaskStatus(
  request: ApkDownloadRequest,
  plugin: Pick<LocalMedUpdatePlugin, 'getLatestApkDownloadStatus'> = localMedUpdate,
): Promise<ApkTaskStatus | null> {
  assertHttpsApkUrl(request.url);
  const result = await plugin.getLatestApkDownloadStatus(request);
  return result.status;
}

export function watchAndroidApkTasks(
  listener: (status: ApkTaskStatus) => void,
  plugin: Pick<LocalMedUpdatePlugin, 'addListener'> = localMedUpdate,
): Promise<PluginListenerHandle> {
  return plugin.addListener('apkDownloadProgress', listener);
}

export function cancelAndroidApkDownload(
  taskId: string,
  plugin: Pick<LocalMedUpdatePlugin, 'cancelApkDownload'> = localMedUpdate,
): Promise<void> {
  return plugin.cancelApkDownload({ taskId });
}

export function installAndroidApk(
  taskId: string,
  plugin: Pick<LocalMedUpdatePlugin, 'installDownloadedApk'> = localMedUpdate,
): Promise<void> {
  return plugin.installDownloadedApk({ taskId });
}
