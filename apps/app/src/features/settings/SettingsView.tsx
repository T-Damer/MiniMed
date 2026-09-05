import type { CoreStatus } from '@localmed/contracts';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { ReleaseLinks } from '@/components/ReleaseLinks';
import { Switch } from '@/components/Switch';
import { AsrSettings } from '@/features/asr/AsrSettings';
import { ContentDownloadStatus } from '@/features/modules/ContentDownloadStatus';
import { AppUpdateChecker } from '@/features/settings/AppUpdateChecker';
import { EcgModelSettings } from '@/features/settings/EcgModelSettings';
import { PackagingImagesSettings } from '@/features/settings/PackagingImagesSettings';
import {
  readSettingsRoute,
  SETTINGS_DOWNLOADS_HASH,
  SETTINGS_ROOT_HASH,
  type SettingsRoute,
} from '@/features/settings/settings-routing';
import { StatusPanel } from '@/features/status/StatusPanel';
import {
  getExperimentalModulesEnabled,
  getFloatingWindowsEnabled,
  getModuleAutoUpdatesEnabled,
  getSoundVolume,
  getVibrationEnabled,
  setExperimentalModulesEnabled,
  setFloatingWindowsEnabled,
  setModuleAutoUpdatesEnabled,
  setSoundVolume,
  setVibrationEnabled,
  subscribeAppPreferences,
} from '@/state/app-preferences';
import type { AppUpdateProgress } from '@/state/app-update';
import {
  consumeAndRestoreReturnTo,
  peekReturnTo,
  RETURN_TO_EVENT,
  returnToControlIcon,
  returnToControlLabel,
} from '@/state/return-navigation';

interface SettingsViewProps {
  readonly status: CoreStatus;
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

export function SettingsView(props: SettingsViewProps): JSX.Element {
  const [moduleAutoUpdatesEnabled, setModuleAutoUpdatesEnabledState] = createSignal(
    getModuleAutoUpdatesEnabled(),
  );
  const [route, setRoute] = createSignal<SettingsRoute>(readSettingsRoute());
  const [vibrationEnabled, setVibrationEnabledState] = createSignal(getVibrationEnabled());
  const [soundVolume, setSoundVolumeState] = createSignal(getSoundVolume());
  const [floatingWindowsEnabled, setFloatingWindowsEnabledState] = createSignal(
    getFloatingWindowsEnabled(),
  );
  const [experimentalModulesEnabled, setExperimentalModulesEnabledState] = createSignal(
    getExperimentalModulesEnabled(),
  );
  const [returnTo, setReturnTo] = createSignal(peekReturnTo());

  const refreshRoute = (): void => {
    const next = window.location.hash.replace(/^#\/?/u, '');
    if (next !== '' && next !== 'settings' && !next.startsWith('settings/')) return;
    const previous = route();
    const resolved = readSettingsRoute();
    setRoute(resolved);
    if (resolved !== previous) window.scrollTo({ top: 0, behavior: 'instant' });
  };

  onMount(() => {
    const syncReturnTo = () => {
      setReturnTo(peekReturnTo());
    };
    window.addEventListener('hashchange', refreshRoute);
    window.addEventListener(RETURN_TO_EVENT, syncReturnTo);
    const unsubscribePreferences = subscribeAppPreferences((preferences) => {
      setVibrationEnabledState(preferences.vibrationEnabled);
      setSoundVolumeState(preferences.soundVolume);
      setFloatingWindowsEnabledState(preferences.floatingWindowsEnabled);
      setExperimentalModulesEnabledState(preferences.experimentalModulesEnabled);
      setModuleAutoUpdatesEnabledState(preferences.moduleAutoUpdatesEnabled);
    });
    onCleanup(() => {
      window.removeEventListener('hashchange', refreshRoute);
      window.removeEventListener(RETURN_TO_EVENT, syncReturnTo);
      unsubscribePreferences();
    });
  });

  const soundPercent = () => Math.round(soundVolume() * 100);

  return (
    <section class="settings-page page-surface page-grain">
      <Show when={route() === 'downloads'}>
        <Page
          class="settings-page__heading settings-page__heading--subroute"
          navigation={
            <NavBack
              class="knowledge-back-button"
              aria-label="К настройкам"
              onClick={() => {
                window.location.hash = SETTINGS_ROOT_HASH;
              }}
              icon={<AppGlyph name="arrow-left" class="settings-page__back-icon" />}
            />
          }
          icon={<AppGlyph name="download" class="page__icon-glyph" />}
          title={<h1 class="settings-page__title">Загрузки</h1>}
          description="Наборы документов, прогресс и повтор прерванных загрузок."
        />
        <ContentDownloadStatus />
        <PackagingImagesSettings />
      </Show>
      <Show when={route() === 'index'}>
        <Page
          class="settings-page__heading"
          navigation={
            <Show when={returnTo()}>
              {(returnTo) => (
                <Button
                  type="button"
                  variant="icon"
                  class="knowledge-back-button return-navigation-button settings-page__return"
                  aria-label={returnToControlLabel(returnTo())}
                  title={returnToControlLabel(returnTo())}
                  onClick={() => consumeAndRestoreReturnTo()}
                  icon={<AppGlyph name={returnToControlIcon(returnTo())} />}
                />
              )}
            </Show>
          }
          icon={<AppGlyph name="system" class="page__icon-glyph" />}
          title={<h1 class="settings-page__title">Настройки</h1>}
          description="Параметры интерфейса, локальных данных и моделей MiniMed."
        />

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
          class="settings-section settings-section--interface paper-sheet"
          aria-labelledby="settings-interface-heading"
        >
          <header class="settings-section__heading">
            <div class="settings-section__heading-main">
              <AppGlyph name="system" class="settings-section__icon" />
              <h2 id="settings-interface-heading" class="settings-section__title">
                Интерфейс
              </h2>
            </div>
          </header>

          <div class="settings-row">
            <div class="settings-row__text">
              <span class="settings-row__label settings-row__label--with-icon">
                <AppGlyph name="vibrate" class="settings-row__label-icon" aria-hidden="true" />
                Вибрация
              </span>
            </div>
            <Switch
              checked={vibrationEnabled()}
              aria-label="Вибрация"
              onChange={(checked) => setVibrationEnabled(checked)}
            />
          </div>

          <div class="settings-row">
            <div class="settings-row__text">
              <span class="settings-row__label settings-row__label--with-icon">
                <AppGlyph
                  name="frame-corners"
                  class="settings-row__label-icon"
                  aria-hidden="true"
                />
                Отключить плавающие окна
              </span>
              <p class="settings-row__helper">
                Скрыть кнопку и закрыть уже открытые маленькие окна
              </p>
            </div>
            <Switch
              checked={!floatingWindowsEnabled()}
              aria-label="Отключить плавающие окна"
              onChange={(disabled) => setFloatingWindowsEnabled(!disabled)}
            />
          </div>

          <div class="settings-row">
            <div class="settings-row__text">
              <span class="settings-row__label settings-row__label--with-icon">
                <AppGlyph name="cube" class="settings-row__label-icon" aria-hidden="true" />
                Experimental
              </span>
              <p class="settings-row__helper">
                Показывать загрузку предварительных баз препаратов, калькуляторов и опросников. Они
                могут быть неполными или измениться без обратной совместимости.
              </p>
            </div>
            <Switch
              checked={experimentalModulesEnabled()}
              aria-label="Экспериментальные базы"
              onChange={(checked) => setExperimentalModulesEnabled(checked)}
            />
          </div>

          <div class="settings-row">
            <div class="settings-row__text">
              <span class="settings-row__label">Автообновление пакетов знаний</span>
              <p class="settings-row__helper">
                Автоматически скачивать новые версии уже установленных пакетов.
              </p>
            </div>
            <Switch
              checked={moduleAutoUpdatesEnabled()}
              aria-label="Автообновление пакетов знаний"
              onChange={setModuleAutoUpdatesEnabled}
            />
          </div>

          <div class="settings-slider range-input">
            <div class="range-input__header">
              <span class="range-input__label range-input__label--with-icon">
                <AppGlyph name="speaker-high" class="range-input__label-icon" aria-hidden="true" />
                Звуки
              </span>
              <span class="range-input__value">{soundPercent()}%</span>
            </div>
            <input
              class="range-input__control"
              type="range"
              min={0}
              max={100}
              step={1}
              value={soundPercent()}
              aria-label="Громкость звуков интерфейса"
              onInput={(event) => {
                const next = Number(event.currentTarget.value) / 100;
                setSoundVolumeState(next);
                setSoundVolume(next);
              }}
            />
          </div>
        </section>

        <a
          class="settings-section settings-section--downloads paper-sheet"
          href={SETTINGS_DOWNLOADS_HASH}
          aria-labelledby="settings-downloads-heading"
        >
          <div class="settings-section__heading">
            <div class="settings-section__heading-main">
              <AppGlyph name="download" class="settings-section__icon" />
              <div class="settings-section__heading-copy">
                <h2 id="settings-downloads-heading" class="settings-section__title">
                  Загрузки
                </h2>
                <p class="settings-section__description">
                  Наборы документов, прогресс и повтор прерванных загрузок
                </p>
              </div>
            </div>
          </div>
          <ContentDownloadStatus compact />
        </a>

        <EcgModelSettings />

        <AsrSettings />

        <details class="system-technical-panel">
          <summary class="system-technical-panel__summary">
            <span class="system-technical-panel__summary-text">
              Техническая информация о приложении
            </span>
            <AppGlyph
              name="caret-down"
              class="system-technical-panel__chevron"
              aria-hidden="true"
            />
          </summary>
          <StatusPanel initialStatus={props.status} />
        </details>

        <nav class="settings-page__links" aria-label="Ссылки приложения">
          <ReleaseLinks linkClass="settings-page__link" />
        </nav>
      </Show>
    </section>
  );
}
