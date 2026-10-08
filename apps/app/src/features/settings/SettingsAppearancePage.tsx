import { createSignal, type JSX, onCleanup, onMount } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { RangeSlider } from '@/components/RangeSlider';
import { SegmentedControl } from '@/components/SegmentedControl';
import { StepSlider } from '@/components/StepSlider';
import { Switch } from '@/components/Switch';
import { THEME_LABELS } from '@/features/settings/settings-status';
import {
  getFloatingWindowsEnabled,
  getMotionSpeed,
  getSoundVolume,
  getSplitNavigation,
  getVibrationEnabled,
  isMotionSpeed,
  setFloatingWindowsEnabled,
  setMotionSpeed,
  setSoundVolume,
  setSplitNavigation,
  setVibrationEnabled,
  subscribeAppPreferences,
} from '@/state/app-preferences';
import {
  getThemePreference,
  setThemePreference,
  subscribeTheme,
  THEME_PREFERENCES,
} from '@/state/theme';

/** Ordered by speed, slowest to fastest. */
const MOTION_OPTIONS = [
  { value: 'off', label: 'Выкл', hint: 'Без анимаций: изменения видны сразу.' },
  { value: 'slow', label: 'Медленные', hint: 'Переходы и окна появляются неторопливо.' },
  { value: 'normal', label: 'Обычные', hint: 'Стандартная скорость переходов и окон.' },
  { value: 'fast', label: 'Быстрые', hint: 'Переходы и окна появляются почти мгновенно.' },
] as const;

const THEME_OPTIONS = THEME_PREFERENCES.map((value) => ({ value, label: THEME_LABELS[value] }));

/** «Внешний вид»: theme, animations, sounds, vibration, tab layout and floating windows. */
export function SettingsAppearancePage(): JSX.Element {
  const [splitNavigation, setSplitNavigationState] = createSignal(getSplitNavigation());
  const [vibrationEnabled, setVibrationEnabledState] = createSignal(getVibrationEnabled());
  const [soundVolume, setSoundVolumeState] = createSignal(getSoundVolume());
  const [motionSpeed, setMotionSpeedState] = createSignal(getMotionSpeed());
  const [floatingWindowsEnabled, setFloatingWindowsEnabledState] = createSignal(
    getFloatingWindowsEnabled(),
  );
  const [theme, setTheme] = createSignal(getThemePreference());

  onMount(() => {
    const unsubscribe = subscribeAppPreferences((preferences) => {
      setVibrationEnabledState(preferences.vibrationEnabled);
      setSplitNavigationState(preferences.splitNavigation);
      setSoundVolumeState(preferences.soundVolume);
      setMotionSpeedState(preferences.motionSpeed);
      setFloatingWindowsEnabledState(preferences.floatingWindowsEnabled);
    });
    const unsubscribeTheme = subscribeTheme(() => setTheme(getThemePreference()));
    onCleanup(() => {
      unsubscribe();
      unsubscribeTheme();
    });
  });

  const soundPercent = () => Math.round(soundVolume() * 100);

  return (
    <section
      class="settings-section settings-section--interface paper-sheet"
      aria-label="Внешний вид и поведение"
    >
      <div class="settings-theme">
        <span class="settings-row__label settings-row__label--with-icon">
          <AppGlyph name="palette" class="settings-row__label-icon" aria-hidden="true" />
          Тема
        </span>
        <SegmentedControl
          class="settings-theme__control"
          label="Тема"
          stretch
          options={THEME_OPTIONS}
          value={theme()}
          onChange={(next) => {
            // The control moves at once; the page itself cross-fades to the new theme.
            setTheme(next);
            setThemePreference(next);
          }}
        />
      </div>

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

      <RangeSlider
        class="settings-slider"
        label="Звуки"
        icon={<AppGlyph name="speaker-high" class="range-input__label-icon" aria-hidden="true" />}
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
            <AppGlyph name="frame-corners" class="settings-row__label-icon" aria-hidden="true" />
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
    </section>
  );
}
