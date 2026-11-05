import { For, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Switch } from '@/components/Switch';
import { type ChartSettings, toggleHidden } from '@/features/diary/dashboard/chart-settings';
import {
  COMBINED_GROUP_LABEL,
  type CombinedGroup,
  type CombinedSource,
  type MedicineTrack,
} from '@/features/diary/dashboard/combined-series';

import '@/features/diary/dashboard/chart-settings.css';

/** One row of the chooser: a line or a medicine's track. */
interface Choice {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly shape: 'line' | 'square';
}

const VIEW_SWITCHES: readonly {
  readonly name: 'median' | 'average' | 'alarms' | 'legend';
  readonly label: string;
  readonly hint: string;
}[] = [
  { name: 'median', label: 'Медиана', hint: 'Пунктир на середине значений за период' },
  {
    name: 'average',
    label: 'Среднее за 7 дней',
    hint: 'Плавная линия вместо скачков, измерения бледнее',
  },
  { name: 'alarms', label: 'Красные дни', hint: 'Дни, когда значение перешло порог тревоги' },
  { name: 'legend', label: 'Названия под графиком', hint: 'Цвет и имя каждой линии' },
];

/**
 * What the combined chart shows (DIARY-CHARTS): every line and medicine track of the patient,
 * grouped as the doctor thinks of them, ticked when shown; then how it is drawn. Saved at once for
 * this patient on this device.
 */
export function ChartSettingsSheet(props: {
  readonly sources: readonly CombinedSource[];
  readonly tracks: readonly MedicineTrack[];
  readonly settings: ChartSettings;
  readonly onChange: (change: Partial<ChartSettings>) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const groups = (): { group: CombinedGroup; choices: Choice[] }[] => {
    const lines = (group: CombinedGroup): Choice[] =>
      props.sources
        .filter((source) => source.group === group)
        .map((source) => ({
          key: source.key,
          label: source.label,
          color: source.color,
          shape: 'line',
        }));
    const tracks: Choice[] = props.tracks.map((track) => ({
      key: track.key,
      label: track.label,
      color: track.color,
      shape: 'square',
    }));
    return [
      { group: 'vitals' as const, choices: lines('vitals') },
      { group: 'quiz' as const, choices: lines('quiz') },
      { group: 'medicine' as const, choices: [...tracks, ...lines('medicine')] },
    ].filter((one) => one.choices.length);
  };
  const shown = (key: string): boolean => !props.settings.hidden.includes(key);
  const all = (): string[] => [
    ...props.sources.map((source) => source.key),
    ...props.tracks.map((track) => track.key),
  ];

  return (
    <OverlayDialog
      open
      title="Что показать на графике"
      subtitle="Запоминается для этого пациента"
      class="diary-chart-settings"
      onClose={props.onClose}
    >
      <div class="diary-chart-settings__body">
        <For each={groups()}>
          {(one) => (
            <fieldset class="diary-chart-settings__group">
              <legend class="diary-chart-settings__legend">
                {COMBINED_GROUP_LABEL[one.group]}
              </legend>
              <For each={one.choices}>
                {(choice) => (
                  <Checkbox
                    class="diary-chart-settings__choice"
                    label={
                      <span class="diary-chart-settings__name">
                        <span
                          class={`diary-chart-settings__swatch diary-chart-settings__swatch--${choice.shape}`}
                          style={{ 'background-color': choice.color }}
                          aria-hidden="true"
                        />
                        {choice.label}
                      </span>
                    }
                    checked={shown(choice.key)}
                    onChange={(event) =>
                      props.onChange({
                        hidden: toggleHidden(
                          props.settings.hidden,
                          choice.key,
                          event.currentTarget.checked,
                        ),
                      })
                    }
                  />
                )}
              </For>
            </fieldset>
          )}
        </For>
        <div class="diary-chart-settings__quick">
          <Button
            variant="quiet"
            disabled={!props.settings.hidden.length}
            onClick={() => props.onChange({ hidden: [] })}
          >
            Показать всё
          </Button>
          <Button
            variant="quiet"
            disabled={all().every((key) => !shown(key))}
            onClick={() => props.onChange({ hidden: all() })}
          >
            Снять все
          </Button>
        </div>
        <fieldset class="diary-chart-settings__group">
          <legend class="diary-chart-settings__legend">Вид</legend>
          <For each={VIEW_SWITCHES}>
            {(item) => (
              <div class="diary-chart-settings__switch">
                <span class="diary-chart-settings__switch-text">
                  <span>{item.label}</span>
                  <Show when={item.hint}>
                    <span class="diary-chart-settings__hint">{item.hint}</span>
                  </Show>
                </span>
                <Switch
                  aria-label={item.label}
                  checked={props.settings[item.name]}
                  onChange={(checked) => props.onChange({ [item.name]: checked })}
                />
              </div>
            )}
          </For>
        </fieldset>
      </div>
    </OverlayDialog>
  );
}
