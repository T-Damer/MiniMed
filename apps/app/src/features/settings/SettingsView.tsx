import type { CoreStatus } from '@localmed/contracts';
import { createSignal, type JSX, lazy, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Disclosure } from '@/components/Disclosure';
import { Page } from '@/components/Page';
import { RangeSlider } from '@/components/RangeSlider';
import { ReleaseLinks } from '@/components/ReleaseLinks';
import { StepSlider } from '@/components/StepSlider';
import { Switch } from '@/components/Switch';
import { AsrSettings } from '@/features/asr/AsrSettings';
import { DownloadsPage } from '@/features/downloads/DownloadsPage';
import { ContentDownloadStatus } from '@/features/modules/ContentDownloadStatus';
import { restartOnboarding } from '@/features/onboarding/onboarding-state';
import { SemanticSearchSettings } from '@/features/semantic/SemanticSearchSettings';
import { AppUpdateChecker } from '@/features/settings/AppUpdateChecker';
import { ClinicianProfileSettings } from '@/features/settings/ClinicianProfileSettings';
import { EcgModelSettings } from '@/features/settings/EcgModelSettings';
import { PackagingImagesSettings } from '@/features/settings/PackagingImagesSettings';
import { ReferenceImagesSettings } from '@/features/settings/ReferenceImagesSettings';
import {
  readSettingsRoute,
  SETTINGS_DOWNLOADS_HASH,
  type SettingsRoute,
} from '@/features/settings/settings-routing';
import { StatusPanel } from '@/features/status/StatusPanel';
import {
  getExperimentalModulesEnabled,
  getFloatingWindowsEnabled,
  getModuleAutoUpdatesEnabled,
  getMotionSpeed,
  getSoundVolume,
  getSplitNavigation,
  getVibrationEnabled,
  isMotionSpeed,
  setExperimentalModulesEnabled,
  setFloatingWindowsEnabled,
  setModuleAutoUpdatesEnabled,
  setMotionSpeed,
  setSoundVolume,
  setSplitNavigation,
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

const DevDownloadSettings = import.meta.env.DEV
  ? lazy(() =>
      import('./DevDownloadSettings').then((module) => ({ default: module.DevDownloadSettings })),
    )
  : undefined;

/** Ordered by speed, slowest to fastest. */
const MOTION_OPTIONS = [
  { value: 'off', label: 'Выкл', hint: 'Без анимаций: изменения видны сразу.' },
  { value: 'slow', label: 'Медленные', hint: 'Переходы и окна появляются неторопливо.' },
  { value: 'normal', label: 'Обычные', hint: 'Стандартная скорость переходов и окон.' },
  { value: 'fast', label: 'Быстрые', hint: 'Переходы и окна появляются почти мгновенно.' },
] as const;

interface SettingsViewProps {
  readonly status: CoreStatus | undefined;
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
  /** Connects freshly downloaded packages to the search core. */
  readonly onContentChanged?: () => Promise<void>;
}

export function SettingsView(props: SettingsViewProps): JSX.Element {
  const [moduleAutoUpdatesEnabled, setModuleAutoUpdatesEnabledState] = createSignal(
    getModuleAutoUpdatesEnabled(),
  );
  const [route, setRoute] = createSignal<SettingsRoute>(readSettingsRoute());
  const [splitNavigation, setSplitNavigationState] = createSignal(getSplitNavigation());
  const [vibrationEnabled, setVibrationEnabledState] = createSignal(getVibrationEnabled());
  const [soundVolume, setSoundVolumeState] = createSignal(getSoundVolume());
  const [motionSpeed, setMotionSpeedState] = createSignal(getMotionSpeed());
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
      setSplitNavigationState(preferences.splitNavigation);
      setSoundVolumeState(preferences.soundVolume);
      setMotionSpeedState(preferences.motionSpeed);
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
        <DownloadsPage
          {...(props.onContentChanged ? { onContentChanged: props.onContentChanged } : {})}
        />
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
          description="Внешний вид, загрузки и дополнительные возможности."
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

        <h2 id="settings-interface-heading" class="settings-page__group-title">
          Основное
        </h2>
        <section
          class="settings-section settings-section--interface paper-sheet"
          aria-labelledby="settings-interface-heading"
        >
          {DevDownloadSettings && <DevDownloadSettings />}
          <div class="settings-row">
            <div class="settings-row__text">
              <span class="settings-row__label settings-row__label--with-icon">
                <AppGlyph name="squares-four" class="settings-row__label-icon" aria-hidden="true" />
                Отдельные вкладки разделов
              </span>
              <p class="settings-row__helper">
                Показывать базу знаний, опросники, калькуляторы и заметки отдельными кнопками внизу
                экрана.
              </p>
            </div>
            <Switch
              checked={splitNavigation()}
              aria-label="Отдельные вкладки разделов"
              onChange={setSplitNavigation}
            />
          </div>

          <div class="settings-row">
            <div class="settings-row__text">
              <span class="settings-row__label settings-row__label--with-icon">
                <AppGlyph name="vibrate" class="settings-row__label-icon" aria-hidden="true" />
                Вибрация
              </span>
              <p class="settings-row__helper">Лёгкий отклик телефона при нажатиях.</p>
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
                Плавающие окна
              </span>
              <p class="settings-row__helper">
                Открывать документы и калькуляторы в маленьком окне поверх текущего экрана.
              </p>
            </div>
            <Switch
              checked={floatingWindowsEnabled()}
              aria-label="Плавающие окна"
              onChange={(enabled) => setFloatingWindowsEnabled(enabled)}
            />
          </div>

          <div class="settings-row">
            <div class="settings-row__text">
              <span class="settings-row__label settings-row__label--with-icon">
                <AppGlyph name="flask" class="settings-row__label-icon" aria-hidden="true" />
                Предварительные материалы
              </span>
              <p class="settings-row__helper">
                Показывать черновые наборы препаратов, калькуляторов, опросников и словарь терминов.
                Они могут быть неполными и ещё меняться.
              </p>
            </div>
            <Switch
              checked={experimentalModulesEnabled()}
              aria-label="Предварительные материалы"
              onChange={(checked) => setExperimentalModulesEnabled(checked)}
            />
          </div>

          <div class="settings-row">
            <div class="settings-row__text">
              <span class="settings-row__label settings-row__label--with-icon">
                <AppGlyph name="refresh" class="settings-row__label-icon" aria-hidden="true" />
                Обновлять материалы автоматически
              </span>
              <p class="settings-row__helper">
                Новые версии уже скачанных наборов загружаются сами.
              </p>
            </div>
            <Switch
              checked={moduleAutoUpdatesEnabled()}
              aria-label="Обновлять материалы автоматически"
              onChange={setModuleAutoUpdatesEnabled}
            />
          </div>

          <RangeSlider
            class="settings-slider"
            label="Звуки"
            icon={
              <AppGlyph name="speaker-high" class="range-input__label-icon" aria-hidden="true" />
            }
            valueLabel={`${String(soundPercent())}%`}
            ariaLabel="Громкость звуков интерфейса"
            ariaValueText={`${String(soundPercent())}%`}
            min={0}
            max={100}
            step={1}
            value={soundPercent()}
            onInput={(percent) => {
              const next = percent / 100;
              setSoundVolumeState(next);
              setSoundVolume(next);
            }}
          />

          <StepSlider
            class="settings-slider"
            label="Анимации"
            icon={<AppGlyph name="film-strip" class="range-input__label-icon" aria-hidden="true" />}
            ariaLabel="Скорость анимаций"
            options={MOTION_OPTIONS}
            value={motionSpeed()}
            onChange={(value) => {
              if (isMotionSpeed(value)) setMotionSpeed(value);
            }}
          />

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

        <h2 class="settings-page__group-title">Врач и организация</h2>
        <ClinicianProfileSettings />

        <h2 class="settings-page__group-title">Загрузки</h2>
        <a
          class="settings-section settings-section--downloads paper-sheet"
          href={SETTINGS_DOWNLOADS_HASH}
          aria-labelledby="settings-downloads-heading"
        >
          <div class="settings-section__heading">
            <div class="settings-section__heading-main">
              <AppGlyph name="download-fill" class="settings-section__icon" />
              <div class="settings-section__heading-copy">
                <h3 id="settings-downloads-heading" class="settings-section__title">
                  Скачанные материалы
                </h3>
                <p class="settings-section__description">
                  Что уже на устройстве, что скачивается сейчас и что можно повторить.
                </p>
              </div>
            </div>
          </div>
          <ContentDownloadStatus compact />
        </a>

        <div class="settings-page__group-heading">
          <h2 class="settings-page__group-title">Дополнительные возможности</h2>
          <p class="settings-page__group-description">
            Скачиваются по желанию и дальше работают без интернета.
          </p>
        </div>
        <SemanticSearchSettings />
        <EcgModelSettings />
        <ReferenceImagesSettings />
        <AsrSettings />

        <h2 class="settings-page__group-title">О приложении</h2>
        <Disclosure class="system-technical-panel" title="Техническая информация">
          <Show
            when={props.status}
            fallback={
              <p class="settings-section__description">
                Ядро поиска ещё не готово. Файлы и настройки доступны.
              </p>
            }
          >
            {(status) => <StatusPanel initialStatus={status()} />}
          </Show>
        </Disclosure>

        <nav class="settings-page__links" aria-label="Ссылки приложения">
          <ReleaseLinks linkClass="settings-page__link" />
        </nav>
      </Show>
    </section>
  );
}
