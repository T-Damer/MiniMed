import { createMemo, createSignal, For, type JSX, onMount, Show } from 'solid-js';

import {
  formatScaleNumber,
  type ScoreScaleSpec,
  scoreScaleGeometry,
  scoreScaleSummary,
} from '@/features/calculators/score-scale';

function formatValue(spec: ScoreScaleSpec): string {
  const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: spec.precision }).format(
    spec.value,
  );
  return spec.unit ? `${number} ${spec.unit}` : number;
}

/**
 * A banded track with a marker at the result, declared by the tool schema (`scoreScales`). It only
 * draws the {@link ScoreScaleSpec} the engine produced: the bands are coloured by their declared
 * attention level, the marker slides from the start of the track to the value (with the app motion
 * speed), and the active band's text is written below.
 */
export function ScoreScale(props: {
  readonly spec: ScoreScaleSpec;
  /** Omitted in a result whose own summary already carries the band text. */
  readonly showText?: boolean;
}): JSX.Element {
  const geometry = createMemo(() => scoreScaleGeometry(props.spec));
  const [settled, setSettled] = createSignal(false);
  const activeLabel = (): string | undefined =>
    props.spec.activeBand === undefined
      ? undefined
      : props.spec.bands[props.spec.activeBand]?.label;
  const activeLevel = (): string =>
    (props.spec.activeBand === undefined
      ? undefined
      : props.spec.bands[props.spec.activeBand]?.attentionLevel) ?? 'neutral';

  onMount(() => {
    // The marker starts at the left end and slides to the value once the track is on screen.
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  });

  return (
    <figure
      class="score-scale"
      data-testid="score-scale"
      aria-label={scoreScaleSummary(props.spec)}
    >
      <div class="score-scale__head">
        <Show when={props.spec.label}>
          {(label) => <span class="score-scale__label">{label()}</span>}
        </Show>
        <strong class="score-scale__value">{formatValue(props.spec)}</strong>
        <Show when={!geometry().labelsFitInside}>
          <Show when={activeLabel()}>
            {(label) => (
              <span class={`score-scale__band score-scale__band--${activeLevel()}`}>{label()}</span>
            )}
          </Show>
        </Show>
      </div>
      <div class="score-scale__body">
        <Show when={geometry().labelsFitInside}>
          <div class="score-scale__labels" aria-hidden="true">
            <For each={geometry().segments}>
              {(segment) => (
                <span
                  class="score-scale__segment-label"
                  classList={{
                    'score-scale__segment-label--active': props.spec.activeBand === segment.index,
                  }}
                  style={{ 'flex-basis': `${segment.widthPercent}%` }}
                >
                  {segment.label}
                </span>
              )}
            </For>
          </div>
        </Show>
        <div class="score-scale__track">
          <For each={geometry().segments}>
            {(segment) => (
              <span
                class={`score-scale__segment score-scale__segment--${segment.attentionLevel ?? 'neutral'}`}
                classList={{
                  'score-scale__segment--active': props.spec.activeBand === segment.index,
                  'score-scale__segment--plain': props.spec.bands.length === 0,
                }}
                style={{ 'flex-basis': `${segment.widthPercent}%` }}
                title={segment.label ?? undefined}
              />
            )}
          </For>
          <span
            class="score-scale__marker"
            classList={{
              'score-scale__marker--below': geometry().overflow === 'below',
              'score-scale__marker--above': geometry().overflow === 'above',
            }}
            style={{ left: `${settled() ? geometry().markerPercent : 0}%` }}
            aria-hidden="true"
          />
        </div>
        <Show when={props.spec.layout !== 'equal'}>
          <div class="score-scale__ticks" aria-hidden="true">
            <For each={geometry().ticks}>
              {(tick) => (
                <span
                  class="score-scale__tick"
                  classList={{
                    'score-scale__tick--start': tick.percent <= 0,
                    'score-scale__tick--end': tick.percent >= 100,
                  }}
                  style={{ left: `${tick.percent}%` }}
                >
                  {tick.text}
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>
      <Show when={props.spec.bands.length > 0 && !geometry().labelsFitInside}>
        <ul class="score-scale__legend">
          <For each={geometry().segments}>
            {(segment) => (
              <Show when={segment.label}>
                <li
                  class="score-scale__legend-item"
                  classList={{
                    'score-scale__legend-item--active': props.spec.activeBand === segment.index,
                  }}
                >
                  <span
                    class={`score-scale__swatch score-scale__swatch--${segment.attentionLevel ?? 'neutral'}`}
                    aria-hidden="true"
                  />
                  {segment.label}
                  <Show when={props.spec.layout !== 'equal'}>
                    <span class="score-scale__legend-from">
                      {segment.index === 0
                        ? ` < ${geometry().segments[1]?.fromText ?? formatScaleNumber(props.spec.maximum)}`
                        : ` ≥ ${segment.fromText}`}
                    </span>
                  </Show>
                </li>
              </Show>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.showText !== false && props.spec.text}>
        {(text) => <p class="score-scale__text">{text()}</p>}
      </Show>
    </figure>
  );
}
