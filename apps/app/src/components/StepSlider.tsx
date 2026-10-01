import { createMemo, createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';

import '@/components/StepSlider.css';
import { stepFraction, stepIndexFromRange, stepIndexOf } from '@/components/step-slider';

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
  readonly class?: string;
}

/**
 * Discrete slider over a short ordered list of options: a native range input over option
 * indices, tick marks with labels under the track, the current label as value text and the
 * current option's hint underneath. While dragging only the preview moves; `onChange` fires
 * when the user releases, so a choice with side effects (a model download) is not triggered
 * by every option the thumb passes.
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
  const fraction = () => stepFraction(index(), count());

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
    <div
      class={`step-slider range-input${props.class ? ` ${props.class}` : ''}`}
      classList={{ 'step-slider--disabled': props.disabled ?? false }}
    >
      <div class="range-input__header">
        <span class="range-input__label range-input__label--with-icon">
          {props.icon}
          {props.label}
        </span>
        <span class="range-input__value step-slider__value">{current()?.label}</span>
      </div>
      <div class="step-slider__track">
        <input
          ref={control}
          class="step-slider__control"
          type="range"
          min={0}
          max={Math.max(0, count() - 1)}
          step={1}
          value={committedIndex()}
          disabled={props.disabled}
          aria-label={props.ariaLabel}
          aria-valuetext={current()?.label}
          aria-describedby={current()?.hint ? hintId : undefined}
          style={{ '--step-slider-fraction': String(fraction()) }}
          onInput={(event) => setPreview(stepIndexFromRange(event.currentTarget.value, count()))}
          onChange={settle}
        />
        <div class="step-slider__ticks" aria-hidden="true">
          <For each={props.options}>
            {(option, position) => (
              <span
                class="step-slider__tick"
                classList={{
                  'step-slider__tick--passed': position() < index(),
                  'step-slider__tick--current': position() === index(),
                }}
                style={{ '--step-slider-fraction': String(stepFraction(position(), count())) }}
                data-value={option.value}
              />
            )}
          </For>
        </div>
      </div>
      <div class="step-slider__labels" aria-hidden="true">
        <For each={props.options}>
          {(option, position) => (
            <span
              class="step-slider__option"
              classList={{
                'step-slider__option--first': position() === 0,
                'step-slider__option--last': position() === count() - 1,
                'step-slider__option--current': position() === index(),
              }}
              style={{ '--step-slider-fraction': String(stepFraction(position(), count())) }}
            >
              {option.label}
            </span>
          )}
        </For>
      </div>
      <Show when={current()?.hint}>
        {(hint) => (
          <p id={hintId} class="step-slider__hint">
            {hint()}
          </p>
        )}
      </Show>
    </div>
  );
}
