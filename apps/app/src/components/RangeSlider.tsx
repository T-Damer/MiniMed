import { For, type JSX, Show, splitProps } from 'solid-js';

import '@/components/RangeSlider.css';
import { rangeFraction, stepFraction } from '@/components/step-slider';

export interface RangeSliderProps {
  /** Header text on the left; the header row is omitted when neither label nor value is given. */
  readonly label?: JSX.Element | undefined;
  readonly icon?: JSX.Element | undefined;
  /** Current value shown on the right of the header; pass the same text as `ariaValueText`. */
  readonly valueLabel?: JSX.Element | undefined;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number | undefined;
  readonly ariaLabel: string;
  readonly ariaValueText?: string | undefined;
  readonly disabled?: boolean | undefined;
  /** Number of evenly spaced marks drawn inside the track (a stepped slider); 0 for none. */
  readonly marks?: number | undefined;
  /** Opt-in names of the steps under the track; off unless the header value cannot name them. */
  readonly stepLabels?: readonly string[] | undefined;
  /** Opt-in helper text under the track. */
  readonly helper?: JSX.Element | undefined;
  readonly helperId?: string | undefined;
  readonly onInput?: ((value: number) => void) | undefined;
  readonly onChange?: ((value: number) => void) | undefined;
  readonly controlRef?: ((element: HTMLInputElement) => void) | undefined;
  readonly class?: string | undefined;
}

/**
 * The single range slider of the app: a thick rounded track with a filled progress part and a
 * small round thumb. Stepped sliders add subtle marks inside the track and, only when asked,
 * step names and a helper line. Every `input[type=range]` that is not a multi-thumb range
 * uses this component (or the shared `range-input__control` classes in `RangeSlider.css`).
 */
export function RangeSlider(props: RangeSliderProps): JSX.Element {
  const [local] = splitProps(props, ['class']);
  const fraction = () => rangeFraction(props.value, props.min, props.max);
  const markCount = () => Math.max(0, Math.floor(props.marks ?? 0));
  const currentMark = () => Math.round(fraction() * Math.max(0, markCount() - 1));
  const stepCount = () => props.stepLabels?.length ?? 0;
  const currentStep = () => Math.round(fraction() * Math.max(0, stepCount() - 1));
  const hasHeader = () => props.label !== undefined || props.valueLabel !== undefined;

  return (
    <div
      class={`range-input${local.class ? ` ${local.class}` : ''}`}
      classList={{ 'range-input--disabled': props.disabled ?? false }}
    >
      <Show when={hasHeader()}>
        <div class="range-input__header">
          <span class="range-input__label range-input__label--with-icon">
            {props.icon}
            {props.label}
          </span>
          <span class="range-input__value">{props.valueLabel}</span>
        </div>
      </Show>
      <div class="range-input__track">
        <input
          ref={(element) => props.controlRef?.(element)}
          class="range-input__control"
          type="range"
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          value={props.value}
          disabled={props.disabled}
          aria-label={props.ariaLabel}
          aria-valuetext={props.ariaValueText}
          aria-describedby={props.helper ? props.helperId : undefined}
          style={{ '--range-input-fraction': String(fraction()) }}
          onInput={(event) => props.onInput?.(Number(event.currentTarget.value))}
          onChange={(event) => props.onChange?.(Number(event.currentTarget.value))}
        />
        <Show when={markCount() > 1}>
          <div class="range-input__marks" aria-hidden="true">
            <For each={Array.from({ length: markCount() }, (_, position) => position)}>
              {(position) => (
                <span
                  class="range-input__mark"
                  classList={{
                    'range-input__mark--passed': position < currentMark(),
                    'range-input__mark--current': position === currentMark(),
                  }}
                  style={{ '--range-input-fraction': String(stepFraction(position, markCount())) }}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
      <Show when={stepCount() > 1}>
        <div class="range-input__steps" aria-hidden="true">
          <For each={props.stepLabels}>
            {(name, position) => (
              <span
                class="range-input__step"
                classList={{
                  'range-input__step--first': position() === 0,
                  'range-input__step--last': position() === stepCount() - 1,
                  'range-input__step--current': position() === currentStep(),
                }}
                style={{ '--range-input-fraction': String(stepFraction(position(), stepCount())) }}
              >
                {name}
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.helper}>
        <p id={props.helperId} class="range-input__helper">
          {props.helper}
        </p>
      </Show>
    </div>
  );
}
