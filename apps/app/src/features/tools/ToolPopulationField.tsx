import type { ToolAgeBound } from '@localmed/contracts';
import { type JSX, Show } from 'solid-js';
import { Checkbox } from '@/components/Checkbox';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SelectField } from '@/components/SelectField';
import { TextField } from '@/components/TextField';
import {
  USER_TOOL_POPULATION_GROUPS,
  type UserToolPopulation,
  type UserToolPopulationGroup,
} from '@/features/tools/user-tool-population';

import '@/features/tools/tool-age.css';

const GROUP_OPTIONS = USER_TOOL_POPULATION_GROUPS.map((group) => ({
  value: group.id,
  label: group.label,
}));

const UNIT_OPTIONS = [
  { value: 'days', label: 'дней' },
  { value: 'months', label: 'месяцев' },
  { value: 'years', label: 'лет' },
];

function BoundInput(props: {
  readonly label: string;
  readonly bound: ToolAgeBound | undefined;
  readonly testId: string;
  readonly onChange: (bound: ToolAgeBound | undefined) => void;
}): JSX.Element {
  const unit = (): ToolAgeBound['unit'] => props.bound?.unit ?? 'years';
  return (
    <div class="tool-population__bound">
      <TextField
        class="tool-population__bound-value"
        label={props.label}
        type="number"
        min="0"
        max="130"
        step="1"
        inputmode="numeric"
        data-testid={`${props.testId}-value`}
        value={props.bound?.value ?? ''}
        placeholder="не задано"
        onInput={(event) => {
          const raw = event.currentTarget.value.trim();
          if (!raw) {
            props.onChange(undefined);
            return;
          }
          const value = Math.floor(Number(raw));
          if (Number.isFinite(value) && value >= 0) props.onChange({ value, unit: unit() });
        }}
      />
      <SelectField
        class="tool-population__bound-unit"
        label="Единица"
        hideLabel
        options={UNIT_OPTIONS}
        value={unit()}
        disabled={props.bound === undefined}
        data-testid={`${props.testId}-unit`}
        onChange={(event) => {
          const bound = props.bound;
          if (bound) {
            props.onChange({
              value: bound.value,
              unit: event.currentTarget.value as ToolAgeBound['unit'],
            });
          }
        }}
      />
    </div>
  );
}

/**
 * «Для кого инструмент»: children, adults or any age, with optional age limits. The author's
 * answer becomes the tool's age scope, so the «Дети / Взрослые / Все» filter finds the tool.
 */
export function ToolPopulationField(props: {
  /** Undefined until the author chooses: a tool cannot be used without it. */
  readonly value: UserToolPopulation | undefined;
  readonly onChange: (value: UserToolPopulation) => void;
  readonly error?: string | null | undefined;
  readonly class?: string;
}): JSX.Element {
  const group = (): UserToolPopulationGroup | undefined => props.value?.group;
  const change = (patch: {
    readonly neonates?: boolean | undefined;
    readonly minAge?: ToolAgeBound | undefined;
    readonly maxAge?: ToolAgeBound | undefined;
  }): void => {
    const current = props.value ?? { group: 'any' as const };
    const { minAge: _min, maxAge: _max, neonates: _neo, ...base } = current;
    const merged = { ...current, ...patch };
    const next: UserToolPopulation = {
      ...base,
      ...(merged.neonates ? { neonates: true } : {}),
      ...(merged.minAge ? { minAge: merged.minAge } : {}),
      ...(merged.maxAge ? { maxAge: merged.maxAge } : {}),
    };
    props.onChange(next);
  };
  return (
    <fieldset
      class={`tool-population ${props.class ?? ''}`.trim()}
      data-testid="tool-population"
      aria-describedby="tool-population-hint"
    >
      <legend class="tool-population__legend">Для кого инструмент</legend>
      <p class="tool-population__hint" id="tool-population-hint">
        По этому выбору инструмент попадает в фильтр «Дети / Взрослые / Все».
      </p>
      <SegmentedControl<UserToolPopulationGroup | ''>
        class="tool-population__group"
        label="Возраст пациентов"
        options={GROUP_OPTIONS}
        value={group() ?? ''}
        onChange={(value) => {
          if (value === '') return;
          // Limits of another group do not carry over: a child's range means nothing for adults.
          props.onChange({ group: value });
        }}
      />
      <Show when={group() === 'children'}>
        <Checkbox
          class="tool-population__neonates"
          label="Включая новорождённых"
          checked={props.value?.neonates === true}
          onChange={(event) => change({ neonates: event.currentTarget.checked })}
        />
      </Show>
      <Show when={group() === 'children' || group() === 'adults'}>
        <div class="tool-population__range">
          <BoundInput
            label="Возраст от"
            bound={props.value?.minAge}
            testId="tool-population-min"
            onChange={(minAge) => change({ minAge })}
          />
          <BoundInput
            label="Возраст до"
            bound={props.value?.maxAge}
            testId="tool-population-max"
            onChange={(maxAge) => change({ maxAge })}
          />
        </div>
      </Show>
      <Show when={props.error}>
        {(message) => (
          <p class="tool-population__error" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </fieldset>
  );
}
