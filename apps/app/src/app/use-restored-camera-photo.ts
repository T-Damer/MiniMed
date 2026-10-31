import { onCleanup, onMount } from 'solid-js';
import { openCalculator } from '@/features/calculators/calculator-links';
import { ECG_PHOTO_CALIPER_ID } from '@/features/calculators/calculator-registry';
import { handOffEcgPhoto } from '@/features/calculators/ecg-photo-handoff';
import { listenForRestoredCameraPhoto } from '@/features/camera/native-camera';
import { handOffSkinPhoto } from '@/features/skin/skin-photo-handoff';
import { SKIN_PHOTO_TOOL } from '@/features/skin/skin-tool';

/**
 * Android may kill the WebView while the camera app is open. The photo is then delivered after the
 * restart (see `native-camera.ts`); it goes to the tool that asked for it exactly as a fresh
 * capture would: the ECG editor opens on it, the skin tool freezes it on its TV.
 */
export function useRestoredCameraPhoto(): void {
  onMount(() => {
    let disposed = false;
    let remove: (() => void) | undefined;
    void listenForRestoredCameraPhoto({
      ecg: (file) => {
        handOffEcgPhoto(file);
        openCalculator(ECG_PHOTO_CALIPER_ID);
      },
      skin: (photo) => {
        handOffSkinPhoto(photo);
        window.location.hash = SKIN_PHOTO_TOOL.href;
      },
    }).then(
      (stop) => {
        if (disposed) stop();
        else remove = stop;
      },
      (cause: unknown) => {
        console.warn('Камера: не удалось подписаться на результат после перезапуска.', cause);
      },
    );
    onCleanup(() => {
      disposed = true;
      remove?.();
    });
  });
}
