import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import type { LocalModelController } from './controller';
import type { LocalModelState } from './types';

interface ModelToastProps {
  readonly controller: LocalModelController;
}

const VISIBLE_PHASES = new Set([
  'probing',
  'selecting',
  'downloading',
  'loading',
  'benchmarking',
  'ready',
  'error',
]);

export function ModelToast(props: ModelToastProps): JSX.Element {
  const [state, setState] = createSignal<LocalModelState>(props.controller.getState());
  const [dismissedSignature, setDismissedSignature] = createSignal<string | null>(null);
  let unsubscribe: (() => void) | undefined;

  onMount(() => {
    unsubscribe = props.controller.subscribe((next) => {
      setState(next);
      if (next.phase !== 'ready' && next.phase !== 'error') setDismissedSignature(null);
    });
  });

  onCleanup(() => unsubscribe?.());

  const signature = (): string =>
    `${state().phase}:${state().activeModelId ?? ''}:${state().error ?? ''}`;
  const visible = (): boolean =>
    VISIBLE_PHASES.has(state().phase) && dismissedSignature() !== signature();
  const progressPercent = (): number => Math.round((state().progress ?? 0) * 100);

  return (
    <Show when={visible()}>
      <aside
        class="local-model-toast"
        data-testid="local-model-toast"
        classList={{
          ready: state().phase === 'ready',
          error: state().phase === 'error',
        }}
        aria-live="polite"
        aria-label="Состояние локальной модели"
      >
        <div class="local-model-toast-icon" aria-hidden="true">
          <span />
        </div>
        <div class="local-model-toast-copy">
          <strong>
            {state().phase === 'ready'
              ? 'Локальный ИИ готов'
              : state().phase === 'error'
                ? 'Локальный ИИ не запущен'
                : 'Настраиваем локальный ИИ'}
          </strong>
          <span>{state().message}</span>
          <Show when={state().progress !== null}>
            <div
              class="local-model-progress"
              role="progressbar"
              aria-label="Прогресс загрузки"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={progressPercent()}
            >
              <i style={{ width: `${progressPercent()}%` }} />
            </div>
          </Show>
          <Show when={state().error && state().phase !== 'error'}>
            <small>{state().error}</small>
          </Show>
        </div>
        <div class="local-model-toast-actions">
          <button
            type="button"
            onClick={() => {
              window.history.replaceState({ view: 'status' }, '', '#/status');
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            }}
          >
            Настройки
          </button>
          <Show when={state().phase === 'ready' || state().phase === 'error'}>
            <button
              type="button"
              aria-label="Скрыть уведомление"
              onClick={() => setDismissedSignature(signature())}
            >
              ×
            </button>
          </Show>
        </div>
      </aside>
    </Show>
  );
}
