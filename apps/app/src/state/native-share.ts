import { Capacitor, registerPlugin } from '@capacitor/core';

interface LocalMedSharePlugin {
  shareText(options: { readonly title: string; readonly text: string }): Promise<void>;
  shareFile(options: {
    readonly title: string;
    readonly fileName: string;
    readonly mimeType: string;
    readonly data: string;
  }): Promise<void>;
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

function downloadFile(blob: Blob, fileName: string): 'downloaded' {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

export async function shareSystemFile(input: {
  readonly title: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly blob: Blob;
}): Promise<'shared' | 'cancelled' | 'downloaded'> {
  if (isAndroidNativeShareAvailable()) {
    const bytes = new Uint8Array(await input.blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    }
    await localMedShare.shareFile({
      title: input.title,
      fileName: input.fileName,
      mimeType: input.mimeType || 'application/octet-stream',
      data: btoa(binary),
    });
    return 'shared';
  }

  if (!('share' in navigator) || typeof navigator.share !== 'function') {
    return downloadFile(input.blob, input.fileName);
  }
  const file = new File([input.blob], input.fileName, {
    type: input.mimeType || 'application/octet-stream',
  });
  const payload: ShareData = { title: input.title, files: [file] };
  if (typeof navigator.canShare === 'function' && !navigator.canShare(payload)) {
    return downloadFile(input.blob, input.fileName);
  }
  try {
    await navigator.share(payload);
    return 'shared';
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return 'cancelled';
    if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
      return downloadFile(input.blob, input.fileName);
    }
    throw cause;
  }
}
