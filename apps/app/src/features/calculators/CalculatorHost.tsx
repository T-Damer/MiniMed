import { createEffect, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { CalculatorsView } from '@/features/calculators/CalculatorsView';

function currentRoute(): string {
  return window.location.hash.replace(/^#\/?/u, '');
}

export function CalculatorHost(): JSX.Element {
  const [route, setRoute] = createSignal(currentRoute());
  const open = () => route().startsWith('calculators');
  const assessmentOpen = () => route().startsWith('assessments');

  const refresh = (): void => setRoute(currentRoute());
  onMount(() => window.addEventListener('hashchange', refresh));
  onCleanup(() => window.removeEventListener('hashchange', refresh));

  createEffect(() => {
    document.documentElement.classList.toggle('calculator-route-open', open());
  });
  onCleanup(() => document.documentElement.classList.remove('calculator-route-open'));

  return (
    <Show
      when={open()}
      fallback={
        <Show when={!assessmentOpen()}>
          <button
            class="calculator-launch-button"
            type="button"
            aria-label="Открыть медицинские калькуляторы"
            onClick={() => {
              window.location.hash = '#/calculators';
            }}
          >
            <AppGlyph name="calculator" />
            <span>Расчёты</span>
          </button>
        </Show>
      }
    >
      <div class="calculator-overlay-shell">
        <button
          class="calculator-overlay-close"
          type="button"
          aria-label="Закрыть калькуляторы"
          onClick={() => {
            window.location.hash = '#/search';
          }}
        >
          <AppGlyph name="close" />
        </button>
        <CalculatorsView />
      </div>
    </Show>
  );
}
