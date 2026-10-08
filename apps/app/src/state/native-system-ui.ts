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
/** The theme the user chose in the app; the status-bar icons follow it instead of the device's. */
let themeOverride: 'light' | 'dark' | undefined;

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
      ...(lightIcons
        ? { darkIcons: false }
        : themeOverride !== undefined
          ? { darkIcons: themeOverride === 'light' }
          : {}),
    })
    .catch((cause: unknown) => {
      console.warn('Не удалось изменить тему status bar.', cause);
    });
}

/** The app's own theme choice (`undefined`: follow the device); redraws the status bar icons. */
export function setNativeThemeOverride(theme: 'light' | 'dark' | undefined): void {
  if (theme === themeOverride) return;
  themeOverride = theme;
  syncStatusBar();
}

export function setMedicalImageStatusBar(active: boolean): void {
  medicalImageStatusBarActive = active;
  syncStatusBar();
}

export function setDarkHeaderStatusBar(active: boolean): void {
  darkHeaderOverlayCount = Math.max(0, darkHeaderOverlayCount + (active ? 1 : -1));
  syncStatusBar();
}

/**
 * Tells the Android shell that the first screen is ready under the boot surface, so its splash
 * can fade out. A synchronous JavaScript interface (MainActivity.BootBridge), because plugin calls
 * queue behind the database plugin while it opens the core. True when a native splash was told.
 */
export function reportNativeBootReady(): boolean {
  const bridge = (window as { MiniMedBoot?: { ready(): void } }).MiniMedBoot;
  if (!bridge) return false;
  bridge.ready();
  return true;
}
