import type {
  ContentModuleCatalog,
  DefinitionReferenceHit,
  DefinitionReferenceReply,
  DefinitionReferenceRequest,
  MedicalCore,
} from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';
import { getDoctorProfile } from '@/features/reference/doctor-profile';
import {
  expansionCountLabel,
  groupReferenceHits,
  orderSameNameHits,
  type ReferenceHitGroup,
  referenceAnnotationFlags,
  referenceEntryType,
  referenceLocation,
  referenceLocationLabel,
} from '@/features/reference/reference-entry';
import type { SenseSource } from '@/features/reference/sense-detail';
import { loadTermArticle, type TermArticle } from '@/features/reference/term-article';
import { PackageDownloadRow } from '@/features/setup/PackageDownloadRow';
import { subscribeAppPreferences } from '@/state/app-preferences';
import { openDocumentOverlay } from '@/state/document-navigation';
import { motionMs } from '@/state/motion';
import '@/features/setup/setup.css';
import '@/features/reference/reference.css';

/** The query is searched this long after the last keystroke. */
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

/** One expansion of an abbreviation and the source documents that give it. */
interface AbbreviationExpansion {
  readonly id: string;
  readonly text: string;
  readonly locations: readonly string[];
  /** The record lists more source blocks than the first page read here. */
  readonly moreSources: boolean;
}

interface AbbreviationView {
  readonly title: string;
  readonly expansions: readonly AbbreviationExpansion[];
  /** The source marks different expansions of this spelling across documents. */
  readonly conflicting: boolean;
}

/**
 * A dictionary entry in full: the term, the source's own words and where each of them stands.
 * `initialCard` opens one entry (from the definition card in search); without it the panel is
 * the dictionary tool with its own search field.
 */
export function DefinitionReferencePanel(props: {
  readonly core: MedicalCore;
  readonly onContentChanged: () => Promise<void>;
  readonly catalog?: ContentModuleCatalog | undefined;
  readonly initialCard?: {
    readonly id: string;
    readonly moduleId: string;
    readonly moduleVersion: string;
    readonly editionId: string;
  };
}): JSX.Element {
  const runtime = getContentModuleRuntime(props.catalog ?? MODULE_CATALOG);
  const [revision, setRevision] = createSignal(0);
  const [selection, setSelection] = createSignal('');
  const [query, setQuery] = createSignal('');
  const [hits, setHits] = createSignal<readonly DefinitionReferenceHit[]>([]);
  const [searched, setSearched] = createSignal(false);
  const [article, setArticle] = createSignal<TermArticle | null>(null);
  const [abbreviation, setAbbreviation] = createSignal<AbbreviationView | null>(null);
  const groups = createMemo(() =>
    groupReferenceHits(orderSameNameHits(hits(), getDoctorProfile())),
  );
  const [error, setError] = createSignal<string>();
  const [busy, setBusy] = createSignal(false);
  const [connected, setConnected] = createSignal(false);
  let generation = 0;
  const refresh = () => setRevision((value) => value + 1);
  onCleanup(runtime.subscribe(refresh));
  onCleanup(subscribeAppPreferences(refresh));
  onCleanup(() => {
    generation += 1;
  });
  const candidates = createMemo(() => {
    revision();
    return runtime.getCatalog().modules.filter((module) => {
      const initial = props.initialCard;
      return (
        module.definitionReference &&
        (!initial ||
          (module.id === initial.moduleId &&
            module.version === initial.moduleVersion &&
            module.definitionReference.editionId === initial.editionId))
      );
    });
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
    const activeCore = props.core;
    const module = selected();
    generation += 1;
    setHits([]);
    setSearched(false);
    setArticle(null);
    setAbbreviation(null);
    setError(undefined);
    setBusy(false);
    setConnected(false);
    if (!module?.definitionReference) return;
    if (!activeCore.reference) {
      setError('Справочник недоступен в этом варианте хранилища.');
      return;
    }
    const token = generation;
    const descriptor = module.definitionReference;
    // Registry completion precedes swapping the active MedicalCore. Do not enable lookup on
    // the old owner or clear a user's just-submitted query when the new core becomes ready.
    void activeCore
      .reference({ op: 'status', moduleId: module.id, editionId: descriptor.editionId })
      .then(
        (result) => {
          if (token !== generation) return;
          if (!result.ok) {
            setError(result.error.message);
            return;
          }
          if (result.value.op === 'unavailable') return;
          if (
            result.value.op !== 'status' ||
            result.value.editionId !== descriptor.editionId ||
            result.value.entries !== descriptor.entries
          ) {
            setError('Установленная редакция справочника не совпадает с ожидаемой.');
            return;
          }
          setConnected(true);
        },
        () => {
          if (token === generation) setError('Не удалось подключить установленный справочник.');
        },
      );
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
    if (!module?.definitionReference || !connected()) return;
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
  const search = (text: string) =>
    run(async (token, scope) => {
      const result = await request({ ...scope, op: 'search', query: text, limit: 20 });
      if (result.op !== 'search') throw new Error('Некорректный ответ справочника.');
      if (token !== generation) return;
      setHits(result.hits);
      setSearched(true);
      setArticle(null);
      setAbbreviation(null);
    });
  // Typing searches by itself after a pause; Enter searches at once.
  let pending: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(pending));
  createEffect(
    on(
      () => [query().trim(), connected()] as const,
      ([text, ready]) => {
        clearTimeout(pending);
        if (!ready || props.initialCard) return;
        if (text.length < MIN_QUERY_LENGTH) {
          setHits([]);
          setSearched(false);
          return;
        }
        pending = setTimeout(() => void search(text), motionMs(SEARCH_DEBOUNCE_MS));
      },
      { defer: true },
    ),
  );
  const open = (hit: Pick<DefinitionReferenceHit, 'id'>) =>
    run(async (token, scope) => {
      const result = await loadTermArticle((input) => request(input), scope, hit.id);
      if (token !== generation) return;
      setAbbreviation(null);
      setArticle(result);
    });
  createEffect(
    on(
      () => [props.core, connected(), props.initialCard] as const,
      ([, ready, initial]) => {
        if (ready && initial) void open({ id: initial.id });
      },
    ),
  );
  /** Every expansion of one spelling, each with the documents and sections that give it. */
  const openAbbreviation = (group: ReferenceHitGroup) =>
    run(async (token, scope) => {
      const expansions = await Promise.all(
        group.hits.map(async (entry): Promise<AbbreviationExpansion & { flagged: boolean }> => {
          const blocks = await request({ ...scope, op: 'blocks', id: entry.id });
          if (blocks.op !== 'blocks') throw new Error('Некорректная страница справочника.');
          const texts = await Promise.all(
            blocks.page.blocks
              .filter((item) => item.role === 'definition' || item.role === 'annotation')
              .map(async (item) => {
                const result = await request({
                  ...scope,
                  op: 'text',
                  id: entry.id,
                  chunkId: item.chunkId,
                });
                if (result.op !== 'text' || !result.block)
                  throw new Error('Фрагмент больше не доступен в этой карточке.');
                return { role: item.role, block: result.block };
              }),
          );
          const locations: string[] = [];
          let text = '';
          let flagged = false;
          for (const { role, block: body } of texts) {
            if (role === 'annotation') {
              flagged ||= referenceAnnotationFlags(body.text).includes('conflicting-expansion');
              continue;
            }
            text ||= body.text.trim();
            const label = referenceLocationLabel(referenceLocation(body.provenance));
            if (label && !locations.includes(label)) locations.push(label);
          }
          return { id: entry.id, text, locations, moreSources: blocks.page.next !== null, flagged };
        }),
      );
      if (token !== generation) return;
      setArticle(null);
      setAbbreviation({
        title: group.title,
        // The expansion most documents use comes first; ties keep the search order.
        expansions: expansions
          .map(({ flagged: _flagged, ...expansion }) => expansion)
          .sort(
            (left, right) =>
              Number(right.moreSources) - Number(left.moreSources) ||
              right.locations.length - left.locations.length,
          ),
        conflicting: expansions.some((expansion) => expansion.flagged),
      });
    });
  const openSource = (source: SenseSource) => {
    const link = source.link;
    if (link?.kind === 'document')
      openDocumentOverlay(link.documentId, link.anchor, { preferSummary: true });
  };
  return (
    <section class="reference-panel">
      <Show
        when={available().length > 0}
        fallback={
          <div class="reference-panel__empty">
            <Show
              when={candidates().length > 0}
              fallback={<p class="reference-panel__description">Словарь пока не опубликован.</p>}
            >
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
            </Show>
          </div>
        }
      >
        <Show when={available().length > 1}>
          <select
            class="reference-panel__input"
            aria-label="Редакция"
            value={selected()?.id}
            onChange={(event) => setSelection(event.currentTarget.value)}
          >
            <For each={available()}>
              {(module) => <option value={module.id}>{module.title}</option>}
            </For>
          </select>
        </Show>
        <Show when={!props.initialCard}>
          <form
            class="reference-panel__search"
            onSubmit={(event) => {
              event.preventDefault();
              clearTimeout(pending);
              if (query().trim().length >= MIN_QUERY_LENGTH) void search(query().trim());
            }}
          >
            <input
              class="reference-panel__input"
              type="search"
              aria-label="Термин или описание"
              maxLength={2048}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder="Термин или описание"
              disabled={!connected()}
            />
          </form>
          <Show when={searched() && hits().length === 0}>
            <p class="reference-panel__description">Ничего не найдено.</p>
          </Show>
          <ul class="reference-panel__hits">
            <For each={groups()}>
              {(group) => (
                <li class="reference-panel__hit">
                  <button
                    class="reference-panel__hit-button"
                    type="button"
                    disabled={busy()}
                    onClick={() =>
                      void (group.type === 'abbreviation'
                        ? openAbbreviation(group)
                        : group.hits[0] && open(group.hits[0]))
                    }
                  >
                    {group.title}
                    <Show when={group.type === 'abbreviation'}>
                      <span class="reference-panel__hit-kind">
                        сокращение
                        {group.hits.length > 1
                          ? ` · ${expansionCountLabel(group.hits.length)}`
                          : ''}
                      </span>
                    </Show>
                    <Show when={group.type === 'gloss'}>
                      <span class="reference-panel__hit-kind">словарь</span>
                    </Show>
                    <Show when={group.type !== 'abbreviation' && group.hits[0]?.sense?.fieldLabel}>
                      {(label) => <span class="reference-panel__hit-kind">{label()}</span>}
                    </Show>
                    <Show
                      when={
                        group.type !== 'abbreviation' &&
                        (group.hits[0]?.coverage === 'needs-definition' ||
                          group.hits[0]?.coverage === 'mention-only')
                      }
                    >
                      <span class="reference-panel__hit-kind">нет определения</span>
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={abbreviation()}>
          {(view) => (
            <article class="reference-term reference-term--abbreviation">
              <h3 class="reference-term__title">
                {view().title}
                <Show when={view().expansions.length === 1 && !view().conflicting}>
                  {' → '}
                  {view().expansions[0]?.text}
                </Show>
              </h3>
              <Show when={view().conflicting}>
                <p class="reference-term__note" role="note">
                  В разных документах расшифровки разные: ориентируйтесь на документ, где встретили
                  сокращение.
                </p>
              </Show>
              <Show when={view().expansions.length > 1 || view().conflicting}>
                <ul class="reference-term__list">
                  <For each={view().expansions}>
                    {(expansion) => (
                      <li class="reference-term__list-item">
                        <strong class="reference-term__expansion">{expansion.text}</strong>
                        <span class="reference-term__where">
                          {expansion.locations.join(' · ')}
                          {expansion.moreSources ? ' · и другие документы' : ''}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={view().expansions.length === 1 && !view().conflicting}>
                <p class="reference-term__where">
                  {view().expansions[0]?.locations.join(' · ')}
                  {view().expansions[0]?.moreSources ? ' · и другие документы' : ''}
                </p>
              </Show>
            </article>
          )}
        </Show>
        <Show when={article()} keyed>
          {(term) => (
            <TermView article={term} showTitle={!props.initialCard} onOpenSource={openSource} />
          )}
        </Show>
      </Show>
      <Show when={available().length > 0 && !connected() && !error()}>
        <p class="reference-panel__status" role="status">
          Подключаем словарь…
        </p>
      </Show>
      <Show when={error()}>
        {(message) => (
          <p class="package-row__error" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </section>
  );
}

/** The term, the source's words and a short list of where they stand. */
function TermView(props: {
  readonly article: TermArticle;
  /** A dialog titled with the term already shows it. */
  readonly showTitle: boolean;
  readonly onOpenSource: (source: SenseSource) => void;
}): JSX.Element {
  const card = () => props.article.card;
  const draft = () => props.article.sources.some((source) => !source.official);
  const kind = () => referenceEntryType(card());
  const meta = () => draft() || Boolean(card().sense?.fieldLabel);
  return (
    <article class="reference-term">
      <Show when={props.showTitle || meta()}>
        <header class="reference-term__header">
          <Show when={props.showTitle}>
            <h3 class="reference-term__title">{card().title}</h3>
          </Show>
          <Show when={draft()}>
            <span class="reference-term__badge">черновик</span>
          </Show>
          <Show when={card().sense?.fieldLabel}>
            {(label) => <span class="reference-term__field">{label()}</span>}
          </Show>
        </header>
      </Show>
      <div
        class="reference-term__body"
        classList={{ 'reference-term__body--gloss': kind() === 'gloss' }}
      >
        <For each={props.article.paragraphs}>
          {(paragraph) => (
            <p
              class="reference-term__paragraph"
              classList={{
                'reference-term__paragraph--context': paragraph.role === 'context',
              }}
            >
              {paragraph.text}
            </p>
          )}
        </For>
      </div>
      <Show when={props.article.sources.length > 0}>
        <ul class="reference-term__sources">
          <For each={props.article.sources}>
            {(source) => (
              <li class="reference-term__source">
                <Show
                  when={source.link}
                  fallback={<span class="reference-term__where">{source.label}</span>}
                >
                  {(link) => {
                    const target = link();
                    return target.kind === 'web' ? (
                      <a
                        class="reference-term__link"
                        href={target.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span>{source.label}</span>
                        <AppGlyph name="arrow-square-out" class="reference-term__link-icon" />
                      </a>
                    ) : (
                      <button
                        type="button"
                        class="reference-term__link"
                        onClick={() => props.onOpenSource(source)}
                      >
                        <span>{source.label}</span>
                        <AppGlyph name="arrow-square-out" class="reference-term__link-icon" />
                      </button>
                    );
                  }}
                </Show>
                <Show when={source.credit}>
                  {(credit) => (
                    <span class="reference-term__where">
                      <Show when={credit().authors}>{(authors) => <>{authors()}. </>}</Show>
                      <Show when={credit().license}>
                        {(license) => (
                          <Show when={credit().licenseUrl} fallback={license()}>
                            {(url) => (
                              <a
                                class="reference-term__credit-link"
                                href={url()}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {license()}
                              </a>
                            )}
                          </Show>
                        )}
                      </Show>
                    </span>
                  )}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </article>
  );
}
