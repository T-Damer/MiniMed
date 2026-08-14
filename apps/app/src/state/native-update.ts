import { Capacitor, registerPlugin } from '@capacitor/core';

interface LocalMedUpdatePlugin {
  installApk(options: { readonly url: string }): Promise<{ readonly path: string }>;
}

const localMedUpdate = registerPlugin<LocalMedUpdatePlugin>('LocalMedUpdate');

export async function installAndroidApk(url: string): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') {
    throw new Error('APK updates are available only on Android.');
  }
  await localMedUpdate.installApk({ url });
}
