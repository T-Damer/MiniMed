import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';

export interface ApkDownloadProgress {
  readonly loaded: number;
  readonly total: number;
}

interface LocalMedUpdatePlugin {
  installApk(options: { readonly url: string }): Promise<{ readonly path: string }>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (event: ApkDownloadProgress) => void,
  ): Promise<PluginListenerHandle>;
}

const localMedUpdate = registerPlugin<LocalMedUpdatePlugin>('LocalMedUpdate');

export async function installAndroidApk(
  url: string,
  onProgress?: (progress: ApkDownloadProgress) => void,
): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') {
    throw new Error('APK updates are available only on Android.');
  }
  const listener = onProgress
    ? await localMedUpdate.addListener('downloadProgress', onProgress)
    : undefined;
  try {
    await localMedUpdate.installApk({ url });
  } finally {
    await listener?.remove();
  }
}
