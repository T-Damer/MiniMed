import { type Accessor, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { Button } from '@/components/Button';
import { Switch } from '@/components/Switch';
import { conversationSession } from '@/features/conversations/conversation-session';
import {
  nativeRecordingPlatform,
  observeAndroidSettingsReturn,
  openAndroidNotificationSettings,
  readAndroidNotificationSettings,
  requestAndroidNotifications,
} from '@/features/conversations/native-recording-activity';
import { setRecordingActivityEnabled } from '@/state/app-preferences';

type AndroidSettings = Awaited<ReturnType<typeof readAndroidNotificationSettings>>;

export function NotificationSettings(props: {
  readonly recordingEnabled: Accessor<boolean>;
}): JSX.Element {
  const platform = nativeRecordingPlatform();
  if (!platform) return null;
  const android = platform === 'android';
  const [settings, setSettings] = createSignal<AndroidSettings>();
  const [busy, setBusy] = createSignal(false);
  const [requested, setRequested] = createSignal(false);
  const [readFailed, setReadFailed] = createSignal(false);
  let disposed = false;
  let read = 0;

  const canRequest = () => {
    const permission = settings()?.permission;
    return !requested() && (permission === 'prompt' || permission === 'prompt-with-rationale');
  };

  async function refresh(): Promise<void> {
    if (disposed) return;
    const attempt = ++read;
    try {
      const next = await readAndroidNotificationSettings();
      if (disposed || attempt !== read) return;
      const previous = settings();
      setSettings(next);
      setReadFailed(false);
      if (
        previous &&
        (previous.notificationsEnabled !== next.notificationsEnabled ||
          previous.promotionEnabled !== next.promotionEnabled ||
          previous.recordingChannelBlocked !== next.recordingChannelBlocked)
      ) {
        conversationSession.refreshRecordingActivity();
      }
    } catch (cause) {
      console.warn('Unable to read Android notification settings.', cause);
      if (!disposed && attempt === read) setReadFailed(true);
    }
  }

  if (android) {
    onMount(() => {
      void refresh();
      const stopObserving = observeAndroidSettingsReturn(() => void refresh());
      onCleanup(() => {
        disposed = true;
        stopObserving();
      });
    });
  }

  async function manage(kind: 'app' | 'recording'): Promise<void> {
    if (busy()) return;
    setBusy(true);
    try {
      if (kind === 'app' && canRequest()) {
        setRequested(true);
        await requestAndroidNotifications();
        await refresh();
      } else {
        await openAndroidNotificationSettings(kind);
      }
    } catch (cause) {
      console.warn('Unable to change Android notification settings.', cause);
      if (!disposed) toast.error('Не удалось открыть настройки уведомлений');
    } finally {
      if (!disposed) setBusy(false);
    }
  }

  const recordingSetupNeeded = () => {
    const status = settings();
    return (
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
      <Show when={android}>
        <div class="settings-row">
          <div class="settings-row__text">
            <span class="settings-row__label">Уведомления</span>
            <Show
              when={settings()}
              fallback={
                <Show when={readFailed()}>
                  <p class="settings-row__helper">Статус недоступен</p>
                </Show>
              }
            >
              {(status) => (
                <p class="settings-row__helper">
                  {status().notificationsEnabled ? 'Разрешены' : 'Отключены'}
                </p>
              )}
            </Show>
          </div>
          <Button class="settings-row__action" disabled={busy()} onClick={() => void manage('app')}>
            {canRequest() ? 'Разрешить' : 'Настройки Android'}
          </Button>
        </div>
      </Show>
      <Show when={!android || settings()?.recordingSupported}>
        <div class="settings-row">
          <span class="settings-row__label">Запись в системном индикаторе</span>
          <Switch
            checked={props.recordingEnabled()}
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
          <span class="settings-row__label">Системный индикатор отключён в Android</span>
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
