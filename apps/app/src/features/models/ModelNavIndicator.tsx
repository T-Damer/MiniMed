import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import type { LocalModelController } from '@/features/models/controller';
import type { LocalModelState } from '@/features/models/types';

interface ModelNavIndicatorProps {
  readonly controller: LocalModelController;
}

const ACTIVE_PHASES = new Set<LocalModelState['phase']>(['downloading', 'loading', 'benchmarking']);
const INDETERMINATE_PROGRESS = 0.18;

function pieBackground(progress: number): string {
  const clamped = Math.max(0, Math.min(1, progress));
  const degrees = clamped * 360;
  return `conic-gradient(#cbb37c ${degrees}deg, rgb(255 255 255 / 16%) ${degrees}deg)`;
}

function indicatorLabel(state: LocalModelState): string {
  if (state.phase === 'downloading' || state.phase === 'loading') {
    return state.progress === null
      ? 'Загрузка модели'
      : `Загрузка модели: ${Math.round(state.progress * 100)}%`;
  }
  if (state.phase === 'benchmarking') return 'Проверка модели';
  if (state.phase === 'probing' || state.phase === 'selecting') return 'Подготовка модели';
  return state.message;
}

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
  onCleanup(() => {
    unsubscribe?.();
  });

  const active = (): boolean => ACTIVE_PHASES.has(state().phase);
  const progress = (): number | null => state().progress;

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
          fallback={
            <span
              class="model-nav-indicator-dot"
              title={indicatorLabel(state())}
              aria-hidden="true"
            />
          }
        >
          <button
            type="button"
            class="model-nav-indicator-pie"
            style={{ background: pieBackground(progress() ?? INDETERMINATE_PROGRESS) }}
            title={indicatorLabel(state())}
            aria-label={`${indicatorLabel(state())}. Скрыть индикатор`}
            onClick={() => setDismissed(true)}
          />
        </Show>
      </div>
    </Show>
  );
}
