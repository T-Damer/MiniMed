import { type DefinitionLookup, parseDefinitionCatalog } from '@localmed/core';
import { createMemo, createResource, createSignal, For, type JSX, Show } from 'solid-js';
import { loadDefinitionDraftLookup } from '@/composition/definition-draft-lookup';
import './definition-draft-matches.css';

type LookupState =
  | { readonly ok: true; readonly lookup: DefinitionLookup }
  | { readonly ok: false; readonly message: string };

export function DefinitionDraftMatches(props: { readonly query: string }): JSX.Element {
  const [enabled, setEnabled] = createSignal(false);
  const [attempt, setAttempt] = createSignal(1);
  const [overlay, setOverlay] = createSignal<unknown>();
  const [overlayMessage, setOverlayMessage] = createSignal('');
  let importGeneration = 0;
  async function importOverlay(file: File | undefined): Promise<void> {
    if (!file) return;
    const generation = ++importGeneration;
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('Oversized overlay');
      const value: unknown = JSON.parse(await file.text());
      const validated = parseDefinitionCatalog(value);
      if (generation !== importGeneration) return;
      setOverlay(() => value);
      setOverlayMessage(
        `Локальный пакет: ${validated.terms.length}. Данные только в памяти страницы; на сервер не отправляются.`,
      );
      setAttempt((number) => number + 1);
    } catch {
      if (generation === importGeneration)
        setOverlayMessage('Не удалось прочитать пакет определений. Предыдущий поиск сохранён.');
    }
  }
  const [state] = createResource(
    () => (enabled() ? attempt() : false),
    async (): Promise<LookupState> => {
      try {
        return { ok: true, lookup: await loadDefinitionDraftLookup(overlay()) };
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
        <label class="definition-drafts__import-label">
          Добавить локальный пакет определений (JSON)
          <input
            class="definition-drafts__import"
            type="file"
            accept=".json,application/json"
            onChange={(event) => void importOverlay(event.currentTarget.files?.[0])}
          />
        </label>
        <Show when={overlayMessage()}>
          <p class="definition-drafts__status" role="status">
            {overlayMessage()}
          </p>
        </Show>
        <p class="definition-drafts__notice">
          Словарные тексты и отдельные редакторские черновики. Требуют проверки; не диагностические
          рекомендации. Поиск по названиям, определениям и пунктам критериев работает локально.
          Полные книги и исходные дампы не скачиваются.
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
            В подключённых пакетах подходящих определений не найдено.
          </p>
        </Show>
        <For each={matches()}>
          {(hit) => (
            <article class="definition-drafts__card" data-testid="definition-draft-card">
              <span class="definition-drafts__badge">
                {hit.textKind === 'source-gloss'
                  ? 'Словарный текст · требует проверки'
                  : hit.textKind === 'source-excerpt'
                    ? 'Фрагмент источника · требует проверки'
                    : 'Редакторский черновик · требует проверки'}
              </span>
              <h3 class="definition-drafts__title">{hit.term.title}</h3>
              <p class="definition-drafts__match">
                {hit.matchKind === 'name' ? 'Совпадение по названию' : 'Совпадение по описанию'}
              </p>
              <Show when={hit.term.coverage === 'mention-only'}>
                <p class="definition-drafts__note">
                  Только упоминание: полное описание или инструмент в этом фрагменте отсутствует.
                </p>
              </Show>
              <p class="definition-drafts__definition">{hit.term.definition}</p>
              <Show when={hit.term.etymology?.length}>
                <p class="definition-drafts__note">
                  Происхождение: формулировка источника, требует проверки.
                </p>
                <For each={hit.term.etymology}>
                  {(origin) => <p class="definition-drafts__note">{origin}</p>}
                </For>
              </Show>
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
                  <>
                    <Show
                      when={citation.url}
                      fallback={
                        <p class="definition-drafts__source">
                          {citation.source.title} — {citation.locator} (локальный источник)
                        </p>
                      }
                    >
                      <a
                        class="definition-drafts__source"
                        href={citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {citation.source.title} — {citation.locator} (внешний сайт)
                      </a>
                    </Show>
                    <Show when={citation.source.licenseUrl}>
                      <p class="definition-drafts__note">
                        {citation.source.attribution}. Выборка и нормализация; без перевода и
                        медицинской переработки.
                      </p>
                      <a
                        class="definition-drafts__source"
                        href={citation.source.licenseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {citation.source.license}
                      </a>
                      <a
                        class="definition-drafts__source"
                        href={`${citation.url}?action=history`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        История страницы и авторы
                      </a>
                    </Show>
                  </>
                )}
              </For>
            </article>
          )}
        </For>
      </Show>
    </section>
  );
}
