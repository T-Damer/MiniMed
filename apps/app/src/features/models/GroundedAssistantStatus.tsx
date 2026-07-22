import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import type { GroundedAssistantState, GroundedMedicalCore } from './GroundedMedicalCore';

interface GroundedAssistantStatusProps {
  readonly assistant: GroundedMedicalCore;
}

export function GroundedAssistantStatus(props: GroundedAssistantStatusProps): JSX.Element {
  const [state, setState] = createSignal<GroundedAssistantState>(props.assistant.getAssistantState());
  let unsubscribe: (() => void) | undefined;

  onMount(() => {
    unsubscribe = props.assistant.subscribeAssistant(setState);
  });
  onCleanup(() => unsubscribe?.());

  return (
    <Show when={state().phase !== 'idle'}>
      <aside
        class={`grounded-assistant-status ${state().phase}`}
        aria-live="polite"
        data-testid="grounded-assistant-status"
      >
        <div class="grounded-assistant-heading">
          <span aria-hidden="true" />
          <div>
            <strong>
              {state().phase === 'running'
                ? 'Локальная модель проверяет найденные источники'
                : state().phase === 'applied'
                  ? 'Порядок источников уточнён локально'
                  : 'Использован обычный порядок источников'}
            </strong>
            <p>{state().message}</p>
          </div>
        </div>

        <Show when={state().phase === 'applied'}>
          <details>
            <summary>Что учла локальная модель</summary>
            <div class="grounded-assistant-details">
              <Show when={state().terms.length > 0}>
                <div>
                  <span>Ключевые формулировки</span>
                  <div class="grounded-assistant-tags">
                    <For each={state().terms}>{(term) => <b>{term}</b>}</For>
                  </div>
                </div>
              </Show>
              <Show when={state().clarifyingQuestions.length > 0}>
                <div>
                  <span>Для более точного поиска можно уточнить</span>
                  <ul>
                    <For each={state().clarifyingQuestions}>
                      {(question) => <li>{question}</li>}
                    </For>
                  </ul>
                </div>
              </Show>
              <small>
                Модель могла только изменить порядок уже найденных фрагментов. Она не добавляла
                диагнозы, назначения, дозы или новые источники.
              </small>
            </div>
          </details>
        </Show>

        <Show when={state().phase === 'fallback' && state().error}>
          <details>
            <summary>Почему модель не использована</summary>
            <p class="grounded-assistant-error">{state().error}</p>
          </details>
        </Show>
      </aside>
    </Show>
  );
}
