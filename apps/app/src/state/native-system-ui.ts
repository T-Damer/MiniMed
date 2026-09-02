import { Capacitor, registerPlugin } from '@capacitor/core';

interface LocalMedSystemUiPlugin {
  setStatusBar(options: {
    readonly backgroundColor: string;
    readonly darkIcons?: boolean;
  }): Promise<void>;
}

const localMedSystemUi = registerPlugin<LocalMedSystemUiPlugin>('LocalMedSystemUi');
const MEDICAL_IMAGE_STATUS_BAR_FALLBACK = '#171c19';
const TRANSPARENT_STATUS_BAR = '#00000000';

let medicalImageStatusBarActive = false;
let darkHeaderOverlayCount = 0;

function medicalImageStatusBarColor(): string {
  const viewer = document.querySelector<HTMLElement>('.medical-image-viewer');
  const color = viewer
    ? getComputedStyle(viewer).getPropertyValue('--medical-image-status-bar-color').trim()
    : '';
  return color || MEDICAL_IMAGE_STATUS_BAR_FALLBACK;
}

function syncStatusBar(): void {
  if (Capacitor.getPlatform() !== 'android') return;
  const lightIcons = medicalImageStatusBarActive || darkHeaderOverlayCount > 0;
  void localMedSystemUi
    .setStatusBar({
      backgroundColor:
        medicalImageStatusBarActive && darkHeaderOverlayCount === 0
          ? medicalImageStatusBarColor()
          : TRANSPARENT_STATUS_BAR,
      ...(lightIcons ? { darkIcons: false } : {}),
    })
    .catch((cause: unknown) => {
      console.warn('Не удалось изменить тему status bar.', cause);
    });
}

export function setMedicalImageStatusBar(active: boolean): void {
  medicalImageStatusBarActive = active;
  syncStatusBar();
}

export function setDarkHeaderStatusBar(active: boolean): void {
  darkHeaderOverlayCount = Math.max(0, darkHeaderOverlayCount + (active ? 1 : -1));
  syncStatusBar();
}
