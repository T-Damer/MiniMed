import type { DefinitionLookup } from '@localmed/core';
import { createMemo, createResource, createSignal, For, type JSX, Show } from 'solid-js';
import { loadDefinitionDraftLookup } from '@/composition/definition-draft-lookup';
import './definition-draft-matches.css';

type LookupState =
  | { readonly ok: true; readonly lookup: DefinitionLookup }
  | { readonly ok: false; readonly message: string };

export function DefinitionDraftMatches(props: { readonly query: string }): JSX.Element {
  const [enabled, setEnabled] = createSignal(false);
  const [attempt, setAttempt] = createSignal(1);
  const [state] = createResource(
    () => (enabled() ? attempt() : false),
    async (): Promise<LookupState> => {
      try {
        return { ok: true, lookup: await loadDefinitionDraftLookup() };
      } catch {
        return {
          ok: false,
          message: 'Не удалось открыть черновики определений. Обычный поиск доступен.',
        };
      }
    },
  );
  const matches = createMemo(() => {
    const current = state();
    return enabled() && current?.ok ? current.lookup.search(props.query, 5) : [];
  });
  const error = () => {
    const current = state();
    return current && !current.ok ? current.message : undefined;
  };

  return (
    <section class="definition-drafts" aria-label="Черновики медицинских определений">
      <label class="definition-drafts__toggle">
        <input
          class="definition-drafts__checkbox"
          type="checkbox"
          checked={enabled()}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
        />
        Искать также по определениям — DEV, требует проверки
      </label>
      <Show when={enabled()}>
        <p class="definition-drafts__notice">
          Редакторские пересказы, не оригинальные цитаты. Не проверено врачом; не диагностические
          рекомендации. Названия, части определений и пункты критериев ищутся локально. Полные
          источники не скачиваются.
        </p>
        <Show when={state.loading}>
          <p class="definition-drafts__status" role="status">
            Открываем компактный словарь…
          </p>
        </Show>
        <Show when={error()}>
          {(message) => (
            <div class="definition-drafts__error" role="alert">
              <p class="definition-drafts__status">{message()}</p>
              <button
                class="definition-drafts__retry"
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Повторить
              </button>
            </div>
          )}
        </Show>
        <Show when={!state.loading && !error() && props.query.trim() && matches().length === 0}>
          <p class="definition-drafts__status">
            В этом небольшом словаре подходящих определений нет.
          </p>
        </Show>
        <For each={matches()}>
          {(hit) => (
            <article class="definition-drafts__card" data-testid="definition-draft-card">
              <span class="definition-drafts__badge">Требует проверки</span>
              <h3 class="definition-drafts__title">{hit.term.title}</h3>
              <p class="definition-drafts__match">
                {hit.matchKind === 'name' ? 'Совпадение по названию' : 'Совпадение по описанию'}
              </p>
              <p class="definition-drafts__definition">{hit.term.definition}</p>
              <Show when={hit.term.items.length > 0}>
                <ol class="definition-drafts__items">
                  <For each={hit.term.items}>
                    {(item) => <li class="definition-drafts__item">{item}</li>}
                  </For>
                </ol>
              </Show>
              <Show when={hit.term.note}>
                <p class="definition-drafts__note">{hit.term.note}</p>
              </Show>
              <For each={hit.citations}>
                {(citation) => (
                  <a
                    class="definition-drafts__source"
                    href={citation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {citation.source.title} — {citation.locator} (внешний сайт)
                  </a>
                )}
              </For>
            </article>
          )}
        </For>
      </Show>
    </section>
  );
}
