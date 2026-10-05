import { createSignal, type JSX, lazy, onCleanup, onMount } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Switch } from '@/components/Switch';
import { restartOnboarding } from '@/features/onboarding/onboarding-state';
import { AppUpdateChecker } from '@/features/settings/AppUpdateChecker';
import {
  getModuleAutoUpdatesEnabled,
  setModuleAutoUpdatesEnabled,
  subscribeAppPreferences,
} from '@/state/app-preferences';
import type { AppUpdateProgress } from '@/state/app-update';

const DevDownloadSettings = import.meta.env.DEV
  ? lazy(() =>
      import('./DevDownloadSettings').then((module) => ({ default: module.DevDownloadSettings })),
    )
  : undefined;

export interface SettingsGeneralPageProps {
  readonly appUpdateReady: boolean;
  readonly appUpdating: boolean;
  readonly appUpdateChecking: boolean;
  readonly appUpdateUpToDate: boolean;
  readonly appUpdateProgress: AppUpdateProgress | undefined;
  readonly appUpdateError: string | undefined;
  readonly appUpdateCancellable: boolean;
  readonly onCheckAppUpdate: () => void;
  readonly onActivateAppUpdate: () => void;
  readonly onCancelAppUpdate: () => void;
}

/** «Основные»: the app update, automatic material updates and the onboarding tour. */
export function SettingsGeneralPage(props: SettingsGeneralPageProps): JSX.Element {
  const [moduleAutoUpdates, setModuleAutoUpdatesState] = createSignal(
    getModuleAutoUpdatesEnabled(),
  );
  onMount(() => {
    const unsubscribe = subscribeAppPreferences((preferences) =>
      setModuleAutoUpdatesState(preferences.moduleAutoUpdatesEnabled),
    );
    onCleanup(unsubscribe);
  });
  return (
    <>
      <AppUpdateChecker
        ready={() => props.appUpdateReady}
        checking={() => props.appUpdateChecking}
        upToDate={() => props.appUpdateUpToDate}
        updating={() => props.appUpdating}
        progress={() => props.appUpdateProgress}
        error={() => props.appUpdateError}
        cancellable={() => props.appUpdateCancellable}
        onCheck={props.onCheckAppUpdate}
        onActivate={props.onActivateAppUpdate}
        onCancel={props.onCancelAppUpdate}
      />
      <section
        class="settings-section settings-section--general paper-sheet"
        aria-label="Материалы и обучение"
      >
        {DevDownloadSettings && <DevDownloadSettings />}
        <div class="settings-row">
          <div class="settings-row__text">
            <span class="settings-row__label settings-row__label--with-icon">
              <AppGlyph name="refresh" class="settings-row__label-icon" aria-hidden="true" />
              Обновлять материалы автоматически
            </span>
            <p class="settings-row__helper">Новые версии уже скачанных наборов загружаются сами.</p>
          </div>
          <Switch
            checked={moduleAutoUpdates()}
            aria-label="Обновлять материалы автоматически"
            onChange={setModuleAutoUpdatesEnabled}
          />
        </div>
        <div class="settings-row">
          <div class="settings-row__text">
            <span class="settings-row__label settings-row__label--with-icon">
              <AppGlyph name="question" class="settings-row__label-icon" aria-hidden="true" />
              Обучение
            </span>
            <p class="settings-row__helper">
              Короткая экскурсия по поиску, файлам, инструментам и голосу.
            </p>
          </div>
          <Button class="settings-row__action" onClick={restartOnboarding}>
            Пройти заново
          </Button>
        </div>
      </section>
    </>
  );
}
