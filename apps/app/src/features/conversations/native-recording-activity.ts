import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { createSignal } from 'solid-js';

import { loadAppPreferences } from '@/state/app-preferences';

type RecordingState = 'recording' | 'paused' | 'ended';
interface RecordingPresentation {
  readonly presented: boolean;
}

interface AndroidNotificationSettings {
  readonly notificationsEnabled: boolean;
  readonly recordingSupported: boolean;
  readonly promotionEnabled: boolean;
  readonly recordingChannelBlocked: boolean;
}

type NotificationSettingsKind = 'app' | 'recording';

interface NativeRecordingActivity {
  notificationSettings(): Promise<AndroidNotificationSettings>;
  openNotificationSettings(options: { kind: NotificationSettingsKind }): Promise<void>;
  update(options: { state: RecordingState; elapsedMs: number }): Promise<RecordingPresentation>;
  addListener(
    event: 'presentationChanged',
    listener: (state: RecordingPresentation) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: 'openRecording', listener: () => void): Promise<PluginListenerHandle>;
}

const Native = registerPlugin<NativeRecordingActivity>('LocalMedRecordingActivity');
const RECORDING_URL = 'minimed-recording://open';
const [nativeRecordingPresented, setPresented] = createSignal(false);

export { nativeRecordingPresented };

const PROMPTED_KEY = 'minimed.recording-notification-prompted.v1';
let permissionRequest: Promise<void> | undefined;

export function nativeRecordingPlatform(): 'android' | 'ios' | undefined {
  const platform = Capacitor.getPlatform();
  if (
    Capacitor.isNativePlatform() &&
    (platform === 'android' || platform === 'ios') &&
    Capacitor.isPluginAvailable('LocalMedRecordingActivity')
  ) {
    return platform;
  }
  return undefined;
}

export async function readAndroidNotificationSettings() {
  const status = await Native.notificationSettings();
  const permission = status.notificationsEnabled
    ? 'granted'
    : (await LocalNotifications.checkPermissions()).display;
  return { ...status, permission };
}

export function requestAndroidNotifications(): Promise<void> {
  window.localStorage.setItem(PROMPTED_KEY, '1');
  permissionRequest ??= LocalNotifications.requestPermissions()
    .then(() => undefined)
    .finally(() => {
      permissionRequest = undefined;
    });
  return permissionRequest;
}

export function openAndroidNotificationSettings(kind: NotificationSettingsKind): Promise<void> {
  return Native.openNotificationSettings({ kind });
}

export function observeAndroidSettingsReturn(refresh: () => void): () => void {
  const listener = App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) refresh();
  }).catch((cause: unknown) => {
    console.warn('Unable to watch Android notification settings.', cause);
  });
  return () => {
    void listener
      .then((handle) => handle?.remove())
      .catch((cause: unknown) => {
        console.warn('Unable to remove the notification settings listener.', cause);
      });
  };
}

async function requestRecordingNotificationsOnce(): Promise<void> {
  if (window.localStorage.getItem(PROMPTED_KEY)) return;
  const settings = await readAndroidNotificationSettings();
  if (!settings.recordingSupported || settings.permission !== 'prompt') return;
  if (window.localStorage.getItem(PROMPTED_KEY) || !loadAppPreferences().recordingActivityEnabled) {
    return;
  }
  await requestAndroidNotifications();
}

let openRecording: (() => void) | undefined;
let listeners: Promise<void> | undefined;
let generation = 0;
let active = false;
let pending = Promise.resolve();

function observePresentation(platform: 'android' | 'ios'): Promise<void> {
  const reopen = (): void => {
    if (active) openRecording?.();
  };
  listeners ??= Promise.all([
    Native.addListener('presentationChanged', ({ presented }) => {
      if (!presented) setPresented(false);
    }),
    platform === 'android'
      ? Native.addListener('openRecording', reopen)
      : App.addListener('appUrlOpen', ({ url }) => {
          if (url === RECORDING_URL) reopen();
        }),
  ]).then(() => undefined);
  return listeners;
}

/** The OS owns the clock. The bridge only runs when recording starts, pauses, resumes or ends. */
export function updateNativeRecordingActivity(
  state: RecordingState,
  elapsedMs: () => number,
  controls?: {
    readonly open: () => void;
    readonly onPresented?: () => void;
  },
): void {
  const platform = nativeRecordingPlatform();
  if (!platform) return;
  if (state !== 'ended' && !loadAppPreferences().recordingActivityEnabled) return;
  active = state !== 'ended';
  if (controls) openRecording = controls.open;
  if (!active) {
    openRecording = undefined;
    setPresented(false);
  }
  const request = ++generation;
  pending = pending
    .then(async () => {
      // A stop must clear the old activity before a new recording can publish its own.
      if (state !== 'ended') {
        if (request !== generation) return;
        await observePresentation(platform);
        if (request !== generation) return;
        if (controls?.onPresented && platform === 'android') {
          await requestRecordingNotificationsOnce().catch((cause: unknown) => {
            console.warn('Notification permission could not be requested.', cause);
          });
          if (request !== generation) return;
        }
      }
      const result = await Native.update({ state, elapsedMs: Math.floor(elapsedMs()) });
      if (request !== generation) return;
      setPresented(active && result.presented);
      if (active && result.presented) controls?.onPresented?.();
    })
    .catch((cause: unknown) => {
      if (request === generation) setPresented(false);
      console.warn('The system recording indicator is unavailable.', cause);
    });
}
