import type {
  ContentModuleCatalog,
  DefinitionReferenceBlock,
  DefinitionReferenceHit,
  DefinitionReferencePage,
  DefinitionReferenceReply,
  DefinitionReferenceRequest,
  DefinitionReferenceText,
  MedicalCore,
} from '@localmed/contracts';
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';
import { PackageDownloadRow } from '@/features/setup/PackageDownloadRow';
import { subscribeAppPreferences } from '@/state/app-preferences';
import '@/features/setup/setup.css';
import './reference.css';

const roles = {
  definition: 'Определение',
  item: 'Пункт',
  context: 'Контекст',
  annotation: 'Сведения об источнике',
} as const;

function sourceTitle(metadata: Readonly<Record<string, unknown>> | null): string {
  const source = metadata?.['source'];
  if (source && typeof source === 'object' && 'title' in source && typeof source.title === 'string')
    return source.title;
  return 'Исходный материал';
}

export function DefinitionReferencePanel(props: {
  readonly core: MedicalCore;
  readonly onContentChanged: () => Promise<void>;
  readonly catalog?: ContentModuleCatalog;
}): JSX.Element {
  const runtime = getContentModuleRuntime(props.catalog ?? MODULE_CATALOG);
  const [revision, setRevision] = createSignal(0);
  const [selection, setSelection] = createSignal('');
  const [query, setQuery] = createSignal('');
  const [hits, setHits] = createSignal<readonly DefinitionReferenceHit[]>([]);
  const [searched, setSearched] = createSignal(false);
  const [card, setCard] = createSignal<DefinitionReferenceHit | null>(null);
  const [page, setPage] = createSignal<DefinitionReferencePage>({ blocks: [], next: null });
  const [text, setText] = createSignal<DefinitionReferenceText | null>(null);
  const [block, setBlock] = createSignal<DefinitionReferenceBlock>();
  const [source, setSource] = createSignal<Readonly<Record<string, unknown>> | null>(null);
  const [error, setError] = createSignal<string>();
  const [busy, setBusy] = createSignal(false);
  let generation = 0;
  const refresh = () => setRevision((value) => value + 1);
  onCleanup(runtime.subscribe(refresh));
  onCleanup(subscribeAppPreferences(refresh));
  onCleanup(() => {
    generation += 1;
  });
  const candidates = createMemo(() => {
    revision();
    return runtime.getCatalog().modules.filter((module) => module.definitionReference);
  });
  const available = createMemo(() => {
    revision();
    return candidates().filter((module) =>
      runtime
        .listInstalled()
        .some(
          (installed) =>
            installed.moduleId === module.id &&
            installed.enabled &&
            installed.version === module.version &&
            installed.activeSourceSetDigest === module.sourceSetDigest,
        ),
    );
  });
  const selected = createMemo(
    () => available().find((module) => module.id === selection()) ?? available()[0],
  );
  createEffect(() => {
    props.core;
    selected()?.id;
    selected()?.version;
    generation += 1;
    setHits([]);
    setSearched(false);
    setCard(null);
    setPage({ blocks: [], next: null });
    setText(null);
    setSource(null);
    setBlock(undefined);
    setError(undefined);
    setBusy(false);
  });
  const request = async (input: DefinitionReferenceRequest): Promise<DefinitionReferenceReply> => {
    if (!props.core.reference) throw new Error('Справочник недоступен в этом варианте хранилища.');
    const result = await props.core.reference(input);
    if (!result.ok) throw new Error(result.error.message);
    if (result.value.op === 'unavailable')
      throw new Error('Эта редакция справочника не подключена. Проверьте установку пакета.');
    return result.value;
  };
  const run = async (
    work: (token: number, scope: { moduleId: string; editionId: string }) => Promise<void>,
  ) => {
    const module = selected();
    if (!module?.definitionReference || busy()) return;
    const token = ++generation;
    setBusy(true);
    setError(undefined);
    try {
      await work(token, { moduleId: module.id, editionId: module.definitionReference.editionId });
    } catch (cause) {
      if (token === generation)
        setError(cause instanceof Error ? cause.message : 'Не удалось прочитать справочник.');
    } finally {
      if (token === generation) setBusy(false);
    }
  };
  const search = () =>
    run(async (token, scope) => {
      const result = await request({ ...scope, op: 'search', query: query().trim(), limit: 20 });
      if (result.op !== 'search') throw new Error('Некорректный ответ справочника.');
      if (token !== generation) return;
      setHits(result.hits);
      setSearched(true);
      setCard(null);
      setText(null);
      setSource(null);
    });
  const readText = async (
    token: number,
    scope: { moduleId: string; editionId: string },
    id: string,
    selectedBlock: DefinitionReferenceBlock,
    offset = 0,
  ) => {
    const result = await request({
      ...scope,
      op: 'text',
      id,
      chunkId: selectedBlock.chunkId,
      offset,
    });
    if (result.op !== 'text' || !result.block)
      throw new Error('Фрагмент больше не доступен в этой карточке.');
    const origin = await request({ ...scope, op: 'source', id: result.block.sourceId });
    if (origin.op !== 'source' || !origin.source) throw new Error('Источник фрагмента не найден.');
    if (token !== generation) return;
    setBlock(selectedBlock);
    setText(result.block);
    setSource(origin.source);
  };
  const open = (hit: DefinitionReferenceHit) =>
    run(async (token, scope) => {
      const result = await request({ ...scope, op: 'card', id: hit.id });
      const blocks = await request({ ...scope, op: 'blocks', id: hit.id });
      if (result.op !== 'card' || !result.card || blocks.op !== 'blocks')
        throw new Error('Карточка не найдена.');
      if (token !== generation) return;
      setCard(result.card);
      setPage(blocks.page);
      setText(null);
      setSource(null);
      setBlock(undefined);
      const first = blocks.page.blocks.find(
        (entry) => entry.role === 'definition' || entry.role === 'item',
      );
      if (first) await readText(token, scope, hit.id, first);
    });
  return (
    <section class="reference-panel">
      <p class="reference-panel__notice">
        Определения из источников, а не сгенерированные ответы. Предварительные записи требуют
        проверки; одинаковые названия могут обозначать разные понятия.
      </p>
      <Show
        when={available().length > 0}
        fallback={
          <div class="reference-panel__empty">
            <p class="reference-panel__description">
              Новый справочник пока не подключён. Установите подготовленный пакет ниже. Выпущенный
              русский словарь также доступен как отдельный пакет в обычном поиске.
            </p>
            <Show when={candidates().length === 0}>
              <p class="reference-panel__description">
                Полная предварительная редакция подключается из локальной сборки; публичный файл
                этой редакции ещё не опубликован.
              </p>
            </Show>
          </div>
        }
      >
        <Show when={available().length > 1}>
          <label class="reference-panel__field">
            Редакция
            <select
              class="reference-panel__input"
              value={selected()?.id}
              onChange={(event) => setSelection(event.currentTarget.value)}
            >
              <For each={available()}>
                {(module) => <option value={module.id}>{module.title}</option>}
              </For>
            </select>
          </label>
        </Show>
        <form
          class="reference-panel__search"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <label class="reference-panel__field">
            Термин или описание
            <input
              class="reference-panel__input"
              maxLength={2048}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder="Например: гиперестезия"
            />
          </label>
          <button class="package-row__button" type="submit" disabled={busy() || !query().trim()}>
            Найти
          </button>
        </form>
        <Show when={searched() && hits().length === 0}>
          <p class="reference-panel__description">
            Совпадений в установленной редакции нет. Это не означает, что понятия не существует.
          </p>
        </Show>
        <ul class="reference-panel__hits">
          <For each={hits()}>
            {(hit) => (
              <li class="reference-panel__hit">
                <button
                  class="reference-panel__hit-button"
                  type="button"
                  disabled={busy()}
                  onClick={() => void open(hit)}
                >
                  {hit.title}
                  <Show when={hit.coverage === 'mention-only'}>
                    <span class="reference-panel__hit-note">Только упоминание</span>
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
        <Show when={card()}>
          {(current) => (
            <article class="reference-card">
              <h3 class="reference-card__title">{current().title}</h3>
              <p class="reference-card__review">
                Требует проверки ·{' '}
                {current().textKind === 'editorial-paraphrase'
                  ? 'Редакционное изложение'
                  : 'Текст источника'}
              </p>
              <div class="reference-card__blocks">
                <For each={page().blocks}>
                  {(item, index) => (
                    <button
                      class="package-row__button"
                      type="button"
                      disabled={busy()}
                      aria-pressed={item.linkId === block()?.linkId}
                      onClick={() =>
                        void run((token, scope) => readText(token, scope, current().id, item))
                      }
                    >
                      {roles[item.role]} {index() + 1}
                    </button>
                  )}
                </For>
              </div>
              <Show when={page().next}>
                <button
                  class="package-row__button"
                  type="button"
                  disabled={busy()}
                  onClick={() =>
                    void run(async (token, scope) => {
                      const after = page().next;
                      const result = await request({
                        ...scope,
                        op: 'blocks',
                        id: current().id,
                        ...(after ? { after } : {}),
                      });
                      if (result.op !== 'blocks')
                        throw new Error('Некорректная страница справочника.');
                      if (token === generation) {
                        setPage(result.page);
                        setText(null);
                        setSource(null);
                        setBlock(undefined);
                      }
                    })
                  }
                >
                  Следующие фрагменты
                </button>
              </Show>
              <Show when={text()}>
                {(body) => (
                  <>
                    <p class="reference-card__text">{body().text}</p>
                    <Show when={body().nextOffset !== null}>
                      <button
                        class="package-row__button"
                        type="button"
                        disabled={busy()}
                        onClick={() => {
                          const next = body().nextOffset;
                          const currentBlock = block();
                          if (next !== null && currentBlock)
                            void run((token, scope) =>
                              readText(token, scope, current().id, currentBlock, next),
                            );
                        }}
                      >
                        Продолжение фрагмента
                      </button>
                    </Show>
                    <p class="reference-card__source">Источник: {sourceTitle(source())}</p>
                    <details class="reference-card__provenance">
                      <summary>Источник и точное расположение</summary>
                      <pre class="reference-card__metadata">
                        {JSON.stringify({ source: source(), locator: body().provenance }, null, 2)}
                      </pre>
                    </details>
                  </>
                )}
              </Show>
            </article>
          )}
        </Show>
      </Show>
      <Show when={busy()}>
        <p class="reference-panel__description" role="status">
          Читаем выбранные данные…
        </p>
      </Show>
      <Show when={error()}>
        {(message) => (
          <p class="package-row__error" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={candidates().length > 0}>
        <details class="reference-panel__packages">
          <summary>Пакеты справочника</summary>
          <ul class="package-list">
            <For each={candidates()}>
              {(module) => (
                <PackageDownloadRow
                  module={module}
                  runtime={runtime}
                  revision={revision()}
                  onContentChanged={props.onContentChanged}
                />
              )}
            </For>
          </ul>
        </details>
      </Show>
    </section>
  );
}
