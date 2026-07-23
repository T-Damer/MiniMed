import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { openDocumentInArchive } from '@/state/document-navigation';
import type { GroundedAssistantState, GroundedMedicalCore } from './GroundedMedicalCore';

interface GroundedAssistantStatusProps {
  readonly assistant: GroundedMedicalCore;
}

export function GroundedAssistantStatus(props: GroundedAssistantStatusProps): JSX.Element {
  const [state, setState] = createSignal<GroundedAssistantState>(
    props.assistant.getAssistantState(),
  );
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
                  ? 'Найденные источники проверены локально'
                  : 'Использован обычный порядок источников'}
            </strong>
            <p>{state().message}</p>
          </div>
        </div>

        <Show when={state().phase === 'applied'}>
          <div class="grounded-clinical-output">
            <Show when={state().diagnosisCandidates.length > 0}>
              <section>
                <h3>Диагностические кандидаты для проверки</h3>
                <For each={state().diagnosisCandidates}>
                  {(candidate) => (
                    <article>
                      <strong>{candidate.label}</strong>
                      <p>«{candidate.sourceExcerpt}»</p>
                      <div class="grounded-citations">
                        <For each={candidate.citations}>
                          {(citation) => (
                            <button
                              type="button"
                              onClick={() =>
                                openDocumentInArchive(citation.documentId, citation.anchor)
                              }
                            >
                              {citation.title} · {citation.sectionPath.join(' → ')}
                            </button>
                          )}
                        </For>
                      </div>
                    </article>
                  )}
                </For>
              </section>
            </Show>

            <section>
              <h3>Дозировки из установленных источников</h3>
              <Show
                when={state().doseEvidence.length > 0}
                fallback={
                  <p class="grounded-empty-evidence">
                    Точный режим дозирования не найден. Модель не подставляет дозу из памяти и не
                    рассчитывает её без источника.
                  </p>
                }
              >
                <For each={state().doseEvidence}>
                  {(dose) => (
                    <article>
                      <strong>{dose.label}</strong>
                      <p>«{dose.sourceExcerpt}»</p>
                      <Show when={dose.missingInputs.length > 0}>
                        <small>Нужно уточнить: {dose.missingInputs.join(', ')}.</small>
                      </Show>
                      <div class="grounded-citations">
                        <For each={dose.citations}>
                          {(citation) => (
                            <button
                              type="button"
                              onClick={() =>
                                openDocumentInArchive(citation.documentId, citation.anchor)
                              }
                            >
                              {citation.title} · {citation.sectionPath.join(' → ')}
                            </button>
                          )}
                        </For>
                      </div>
                    </article>
                  )}
                </For>
              </Show>
            </section>
          </div>

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
              <Show when={state().missingInformation.length > 0}>
                <div>
                  <span>Недостающие сведения</span>
                  <ul>
                    <For each={state().missingInformation}>{(item) => <li>{item}</li>}</For>
                  </ul>
                </div>
              </Show>
              <small>
                Диагностические кандидаты и дозировочные фрагменты показываются только как точные
                выдержки из найденных источников. Это не итоговый диагноз и не назначение.
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
