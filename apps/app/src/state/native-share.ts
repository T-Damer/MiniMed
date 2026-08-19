import { Capacitor, registerPlugin } from '@capacitor/core';

interface LocalMedSharePlugin {
  shareText(options: { readonly title: string; readonly text: string }): Promise<void>;
}

const localMedShare = registerPlugin<LocalMedSharePlugin>('LocalMedShare');

export function isAndroidNativeShareAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export async function nativeAndroidShareText(title: string, text: string): Promise<void> {
  if (!isAndroidNativeShareAvailable()) {
    throw new Error('Android share is not available.');
  }
  await localMedShare.shareText({ title, text });
}
