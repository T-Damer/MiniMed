import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import type { LocalModelController } from './controller';
import type { LocalModelState } from './types';

interface ModelNavIndicatorProps {
  readonly controller: LocalModelController;
}

const ACTIVE_PHASES = new Set(['probing', 'selecting', 'downloading', 'loading', 'benchmarking']);

export function ModelNavIndicator(props: ModelNavIndicatorProps): JSX.Element {
  const [state, setState] = createSignal<LocalModelState>(props.controller.getState());
  const [dismissed, setDismissed] = createSignal(false);
  let unsubscribe: (() => void) | undefined;

  onMount(() => {
    unsubscribe = props.controller.subscribe((next) => {
      setState(next);
      if (ACTIVE_PHASES.has(next.phase)) setDismissed(false);
    });
  });
  onCleanup(() => unsubscribe?.());

  const active = (): boolean => ACTIVE_PHASES.has(state().phase);
  const progressPercent = (): number => Math.round((state().progress ?? 0) * 100);
  const compactLabel = (): string => {
    if (state().phase === 'downloading' || state().phase === 'loading') {
      return state().progress === null ? 'Загрузка…' : `${progressPercent()}%`;
    }
    if (state().phase === 'benchmarking') return 'Проверка…';
    if (state().phase === 'probing' || state().phase === 'selecting') return 'Модель…';
    return 'Модель…';
  };

  return (
    <Show when={active()}>
      <div
        class="model-nav-indicator"
        classList={{ dismissed: dismissed() }}
        data-testid="model-nav-indicator"
        aria-live="polite"
      >
        <Show
          when={!dismissed()}
          fallback={<span class="model-nav-indicator-dot" title={state().message} />}
        >
          <div class="model-nav-indicator-card">
            <span>{compactLabel()}</span>
            <Show when={state().progress !== null}>
              <div class="model-nav-indicator-progress">
                <i style={{ width: `${progressPercent()}%` }} />
              </div>
            </Show>
            <button
              type="button"
              aria-label="Скрыть индикатор загрузки модели"
              onClick={() => setDismissed(true)}
            >
              ×
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
