import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { type Accessor, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Switch } from '@/components/Switch';
import { conversationSession } from '@/features/conversations/conversation-session';
import {
  nativeRecordingPlatform,
  observeNativeSettingsReturn,
  openAndroidNotificationSettings,
  readAndroidNotificationSettings,
  requestAndroidNotifications,
} from '@/features/conversations/native-recording-activity';
import { setNotificationsEnabled, setRecordingActivityEnabled } from '@/state/app-preferences';

type AndroidSettings = Awaited<ReturnType<typeof readAndroidNotificationSettings>>;

export function NotificationSettings(props: {
  readonly enabled: Accessor<boolean>;
  readonly recordingEnabled: Accessor<boolean>;
}): JSX.Element {
  const native = Capacitor.isNativePlatform();
  const recordingPlatform = nativeRecordingPlatform();
  const android = recordingPlatform === 'android';
  if (!native && !('Notification' in window)) return null;
  const [settings, setSettings] = createSignal<AndroidSettings>();
  const [permission, setPermission] = createSignal<AndroidSettings['permission']>();
  const [busy, setBusy] = createSignal(false);
  const [requested, setRequested] = createSignal(false);
  const [readFailed, setReadFailed] = createSignal(false);
  let disposed = false;
  let read = 0;

  const canRequest = () =>
    !requested() && (permission() === 'prompt' || permission() === 'prompt-with-rationale');

  async function refresh(): Promise<void> {
    if (disposed) return;
    const attempt = ++read;
    try {
      if (android) {
        const next = await readAndroidNotificationSettings();
        if (disposed || attempt !== read) return;
        const previous = settings();
        setSettings(next);
        // The native plugin reports system-wide and channel-level controls separately.
        setPermission(
          next.notificationsEnabled
            ? 'granted'
            : next.permission === 'granted'
              ? 'denied'
              : next.permission,
        );
        if (
          previous &&
          (previous.notificationsEnabled !== next.notificationsEnabled ||
            previous.promotionEnabled !== next.promotionEnabled ||
            previous.recordingChannelBlocked !== next.recordingChannelBlocked)
        ) {
          conversationSession.refreshRecordingActivity();
        }
      } else {
        const next = native
          ? (await LocalNotifications.checkPermissions()).display
          : Notification.permission;
        if (disposed || attempt !== read) return;
        setPermission(next === 'default' ? 'prompt' : next);
      }
      setReadFailed(false);
    } catch (cause) {
      console.warn('Unable to read notification settings.', cause);
      if (!disposed && attempt === read) setReadFailed(true);
    }
  }

  onMount(() => {
    const refreshStatus = () => void refresh();
    refreshStatus();
    const stopObserving = native ? observeNativeSettingsReturn(refreshStatus) : undefined;
    if (!native) window.addEventListener('focus', refreshStatus);
    onCleanup(() => {
      disposed = true;
      stopObserving?.();
      if (!native) window.removeEventListener('focus', refreshStatus);
    });
  });

  async function manage(kind: 'app' | 'recording'): Promise<void> {
    if (busy()) return;
    setBusy(true);
    try {
      if (kind === 'app' && (canRequest() || readFailed())) {
        if (readFailed()) {
          await refresh();
        } else {
          setRequested(true);
          if (android) await requestAndroidNotifications();
          else if (native) await LocalNotifications.requestPermissions();
          else await Notification.requestPermission();
          await refresh();
        }
      } else if (android) {
        await openAndroidNotificationSettings(kind);
      }
    } catch (cause) {
      console.warn('Unable to change notification settings.', cause);
      if (!disposed) toast.error('Не удалось изменить настройки уведомлений');
    } finally {
      if (!disposed) setBusy(false);
    }
  }

  const recordingSetupNeeded = () => {
    const status = settings();
    return (
      props.enabled() &&
      status?.recordingSupported &&
      status.notificationsEnabled &&
      props.recordingEnabled() &&
      (!status.promotionEnabled || status.recordingChannelBlocked)
    );
  };

  return (
    <section
      class="settings-section settings-section--general paper-sheet"
      aria-label="Уведомления"
    >
      <div class="settings-row">
        <div class="settings-row__text">
          <span class="settings-row__label settings-row__label--with-icon">
            <AppGlyph name="bell" class="settings-row__label-icon" aria-hidden="true" />
            Уведомления
          </span>
          <Show when={permission() === 'denied' && !android}>
            <p class="settings-row__helper">
              {native ? 'Разрешите в настройках устройства.' : 'Разрешите в настройках браузера.'}
            </p>
          </Show>
        </div>
        <Show when={permission() === 'granted'}>
          <Switch
            checked={props.enabled()}
            aria-label="Уведомления"
            onChange={(enabled) => {
              setNotificationsEnabled(enabled);
              conversationSession.refreshRecordingActivity();
            }}
          />
        </Show>
        <Show when={permission() !== 'granted' && (android || canRequest() || readFailed())}>
          <Button class="settings-row__action" disabled={busy()} onClick={() => void manage('app')}>
            {readFailed() ? 'Повторить' : canRequest() ? 'Разрешить' : 'Настройки Android'}
          </Button>
        </Show>
      </div>
      <Show when={recordingPlatform === 'ios' || settings()?.recordingSupported}>
        <div class="settings-row">
          <span class="settings-row__label settings-row__label--with-icon">
            <AppGlyph name="microphone" class="settings-row__label-icon" aria-hidden="true" />
            Запись в системном индикаторе
          </span>
          <Switch
            checked={props.recordingEnabled()}
            disabled={!props.enabled()}
            aria-label="Запись в системном индикаторе"
            onChange={(enabled) => {
              setRecordingActivityEnabled(enabled);
              conversationSession.refreshRecordingActivity();
            }}
          />
        </div>
      </Show>
      <Show when={recordingSetupNeeded()}>
        <div class="settings-row">
          <span class="settings-row__label settings-row__label--with-icon">
            <AppGlyph name="system" class="settings-row__label-icon" aria-hidden="true" />
            Системный индикатор отключён в Android
          </span>
          <Button
            class="settings-row__action"
            disabled={busy()}
            onClick={() => void manage('recording')}
          >
            Настроить
          </Button>
        </div>
      </Show>
    </section>
  );
}
