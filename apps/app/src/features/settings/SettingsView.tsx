import type { CoreStatus } from '@localmed/contracts';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ReleaseLinks } from '@/components/ReleaseLinks';
import { Switch } from '@/components/Switch';
import type { LocalModelController } from '@/features/models/controller';
import { ModelSettings } from '@/features/models/ModelSettings';
import type { LocalModelState } from '@/features/models/types';
import { StatusPanel } from '@/features/status/StatusPanel';
import {
  getRememberSearchMode,
  getSoundVolume,
  getVibrationEnabled,
  setRememberSearchMode,
  setSoundVolume,
  setVibrationEnabled,
  subscribeAppPreferences,
} from '@/state/app-preferences';
import {
  consumeAndRestoreReturnTo,
  peekReturnTo,
  RETURN_TO_EVENT,
  returnToControlIcon,
  returnToControlLabel,
} from '@/state/return-navigation';

interface SettingsViewProps {
  readonly controller: LocalModelController;
  readonly status: CoreStatus;
}

export function SettingsView(props: SettingsViewProps): JSX.Element {
  const [vibrationEnabled, setVibrationEnabledState] = createSignal(getVibrationEnabled());
  const [rememberSearchMode, setRememberSearchModeState] = createSignal(getRememberSearchMode());
  const [soundVolume, setSoundVolumeState] = createSignal(getSoundVolume());
  const [model, setModel] = createSignal<LocalModelState>(props.controller.getState());
  const [returnTo, setReturnTo] = createSignal(peekReturnTo());

  onMount(() => {
    const syncReturnTo = () => {
      setReturnTo(peekReturnTo());
    };
    window.addEventListener(RETURN_TO_EVENT, syncReturnTo);
    const unsubscribePreferences = subscribeAppPreferences((preferences) => {
      setVibrationEnabledState(preferences.vibrationEnabled);
      setRememberSearchModeState(preferences.rememberSearchMode);
      setSoundVolumeState(preferences.soundVolume);
    });
    const unsubscribeModel = props.controller.subscribe(setModel);
    onCleanup(() => {
      window.removeEventListener(RETURN_TO_EVENT, syncReturnTo);
      unsubscribePreferences();
      unsubscribeModel();
    });
  });

  const soundPercent = () => Math.round(soundVolume() * 100);

  return (
    <section class="settings-page page-surface page-grain">
      <header class="settings-page__heading subpage-heading">
        <div class="settings-page__heading-main">
          <p class="archive-kicker">Устройство</p>
          <h1 class="settings-page__title">Настройки</h1>
        </div>
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
      </header>

      <section class="settings-group paper-card" aria-labelledby="settings-interface-heading">
        <h2 id="settings-interface-heading" class="settings-group__title">
          Интерфейс
        </h2>

        <div class="settings-row">
          <div class="settings-row__text">
            <span class="settings-row__label">Вибрация</span>
          </div>
          <Switch
            checked={vibrationEnabled()}
            aria-label="Вибрация"
            onChange={(checked) => setVibrationEnabled(checked)}
          />
        </div>

        <div class="settings-row">
          <div class="settings-row__text">
            <span class="settings-row__label">Запоминать режим поиска</span>
            <p class="settings-row__helper">Открывать поиск с последним выбранным режимом</p>
          </div>
          <Switch
            checked={rememberSearchMode()}
            aria-label="Запоминать режим поиска"
            onChange={(checked) => setRememberSearchMode(checked)}
          />
        </div>

        <div class="settings-slider range-input">
          <div class="range-input__header">
            <span class="range-input__label">Звуки</span>
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

      <ModelSettings controller={props.controller} />

      <details class="system-technical-panel">
        <summary>Техническая информация о приложении</summary>
        <section class="system-model-technical">
          <h3>Локальная модель</h3>
          <div class="model-settings-summary">
            <div>
              <span>Режим</span>
              <strong>
                {props.controller.getPreference().automatic ? 'автоматический' : 'ручной'}
              </strong>
            </div>
            <div>
              <span>Каталог</span>
              <strong>{model().catalogSource ?? 'не загружен'}</strong>
            </div>
            <div>
              <span>Устройство</span>
              <strong>
                {model().device
                  ? `${model().device?.platform} · ${model().device?.deviceMemoryGb ?? '?'} ГБ`
                  : 'не проверено'}
              </strong>
            </div>
            <Show when={model().benchmark}>
              {(benchmark) => (
                <div>
                  <span>Последний тест</span>
                  <strong>
                    {Math.round(benchmark().loadMs)} мс / {Math.round(benchmark().generationMs)} мс
                  </strong>
                </div>
              )}
            </Show>
          </div>
        </section>
        <StatusPanel initialStatus={props.status} />
      </details>

      <nav class="settings-page__links" aria-label="Ссылки приложения">
        <ReleaseLinks linkClass="settings-page__link" />
      </nav>
    </section>
  );
}
