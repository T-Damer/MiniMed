import { createMemo, createSignal, type JSX, Show } from 'solid-js';

import { featureOfDayIndex } from '@/features/search/feature-of-day';

export interface HomeFeature {
  readonly id: string;
  readonly render: () => JSX.Element;
}

/** One rotating capability instead of a permanent large card: today's, or the next on request. */
export function FeatureOfDay(props: { readonly features: readonly HomeFeature[] }): JSX.Element {
  const [offset, setOffset] = createSignal(0);
  const index = createMemo(() => {
    const count = props.features.length;
    return count === 0 ? 0 : (featureOfDayIndex(count, new Date()) + offset()) % count;
  });
  const current = createMemo(() => props.features[index()]);
  return (
    <Show when={current()}>
      <div class="feature-of-day">
        <div class="feature-of-day__bar">
          <span class="feature-of-day__label">Возможность дня</span>
          <Show when={props.features.length > 1}>
            <span class="feature-of-day__position" aria-hidden="true">
              {index() + 1} из {props.features.length}
            </span>
            <button
              type="button"
              class="feature-of-day__next"
              aria-label="Показать другую возможность"
              onClick={() => setOffset((value) => value + 1)}
            >
              Другая
            </button>
          </Show>
        </div>
        <Show when={current()} keyed>
          {(feature) => feature.render()}
        </Show>
      </div>
    </Show>
  );
}
