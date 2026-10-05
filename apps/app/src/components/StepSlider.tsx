import { createMemo, createSignal, createUniqueId, type JSX } from 'solid-js';

import { RangeSlider } from '@/components/RangeSlider';
import { stepIndexFromRange, stepIndexOf } from '@/components/step-slider';

export interface StepSliderOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

export interface StepSliderProps<T extends string> {
  readonly label: JSX.Element;
  readonly icon?: JSX.Element;
  readonly options: readonly StepSliderOption<T>[];
  readonly value: T;
  /** Called once the user settles on an option (on release, or on every key press). */
  readonly onChange: (value: T) => void;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  /** Opt-in: names of all options under the track. The current one is already in the header. */
  readonly showStepLabels?: boolean;
  /** Opt-in: the current option's hint under the track, for hints the value label cannot carry. */
  readonly showHint?: boolean;
  readonly class?: string;
}

/**
 * Discrete slider over a short ordered list of options: the shared `RangeSlider` over option
 * indices, with the current label in the header and as value text. While dragging only the
 * preview moves; `onChange` fires when the user releases, so a choice with side effects (a
 * model download) is not triggered by every option the thumb passes.
 */
export function StepSlider<T extends string>(props: StepSliderProps<T>): JSX.Element {
  const hintId = `step-slider-hint-${createUniqueId()}`;
  const [preview, setPreview] = createSignal<number | undefined>(undefined);
  let control: HTMLInputElement | undefined;

  const count = () => props.options.length;
  const committedIndex = createMemo(() =>
    stepIndexOf(
      props.options.map((option) => option.value),
      props.value,
    ),
  );
  const index = () => preview() ?? committedIndex();
  const current = () => props.options[index()];

  const settle = (): void => {
    const next = preview();
    setPreview(undefined);
    // The parent may keep the old value (rejected or still loading): put the thumb back.
    queueMicrotask(() => {
      if (control) control.value = String(committedIndex());
    });
    const option = next === undefined ? undefined : props.options[next];
    if (option && next !== committedIndex()) props.onChange(option.value);
  };

  return (
    <RangeSlider
      class={props.class}
      label={props.label}
      icon={props.icon}
      valueLabel={current()?.label}
      value={index()}
      min={0}
      max={Math.max(0, count() - 1)}
      step={1}
      marks={count()}
      stepLabels={props.showStepLabels ? props.options.map((option) => option.label) : undefined}
      helper={props.showHint ? current()?.hint : undefined}
      helperId={hintId}
      disabled={props.disabled}
      ariaLabel={props.ariaLabel}
      ariaValueText={current()?.label}
      controlRef={(element) => {
        control = element;
      }}
      onInput={(next) => {
        setPreview(stepIndexFromRange(String(next), count()));
      }}
      onChange={settle}
    />
  );
}
