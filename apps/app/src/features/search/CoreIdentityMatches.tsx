import type { CoreIdentityHit, MedicalCore, SearchResultGroup } from '@localmed/contracts';
import { createEffect, createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { OverlayDialog } from '@/components/OverlayDialog';
import { loadModuleCatalog } from '@/features/modules/module-catalog-state';
import { assertIdentityDocumentTarget } from '@/features/modules/module-pointer-install';
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';
import { DefinitionReferencePanel } from '@/features/reference/DefinitionReferencePanel';
import { coreIdentityModule } from '@/features/search/core-identity-navigation';
import {
  definitionFromResults,
  definitionHitHasText,
  definitionPreviewText,
  loadDefinitionPreviewText,
  selectDefinitionPreview,
  splitLeadingTerm,
} from '@/features/search/definition-preview';
import { pluralRu } from '@/i18n/labels';
import { subscribeAppPreferences } from '@/state/app-preferences';
import { openDocumentOverlay } from '@/state/document-navigation';
import '@/features/search/core-identity-matches.css';
import { createQuietResource } from '@/state/quiet-resource';

const COVERAGE_LABELS: Readonly<Record<string, string>> = {
  'explicit-definition': 'определение',
  definition: 'определение',
  gloss: 'словарная статья',
  'source-document': 'документ',
  abbreviation: 'сокращение',
  'mention-only': 'упоминание',
  'needs-definition': 'только название',
};

/**
 * One definition preview above the results: «Термин — начало определения», read from the installed
 * dictionary. The same name from other dictionaries is folded behind «ещё N источника»; other
 * names the query matched are small links.
 */
export function CoreIdentityMatches(props: {
  readonly hits: readonly CoreIdentityHit[];
  readonly query: string;
  /** The search's own results: a found document's definition stands in when no dictionary text is at hand. */
  readonly groups: readonly SearchResultGroup[];
  readonly core: MedicalCore;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  // Quiet resources: the preview loads and reloads in place (a core swap, an install), never
  // through the page-level loader.
  const catalog = createQuietResource(loadModuleCatalog);
  const runtime = createMemo(() => {
    const value = catalog.value();
    return value ? getContentModuleRuntime(value) : undefined;
  });
  const [revision, setRevision] = createSignal(0);
  const [selected, setSelected] = createSignal<CoreIdentityHit>();
  const [opening, setOpening] = createSignal(false);
  const [othersOpen, setOthersOpen] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const refresh = () => setRevision((value) => value + 1);
  onCleanup(subscribeAppPreferences(refresh));
  createEffect(() => {
    const value = runtime();
    if (value) onCleanup(value.subscribe(refresh));
  });
  const moduleFor = (hit: CoreIdentityHit) => {
    revision();
    const value = runtime();
    return value ? coreIdentityModule(hit, value.getCatalog(), value.listInstalled()) : undefined;
  };
  const selection = createMemo(() => selectDefinitionPreview(props.hits, props.query));
  const primary = () => selection()?.main.primary;

  const definition = createQuietResource(
    () => {
      const hit = primary();
      const module = hit ? moduleFor(hit) : undefined;
      return hit && module && definitionHitHasText(hit)
        ? { hit, module, core: props.core, revision: revision() }
        : undefined;
    },
    async ({ hit, module, core }) => {
      const text = await loadDefinitionPreviewText(core, hit, module);
      return text ? definitionPreviewText(text) : null;
    },
  );
  const fromResults = createMemo(() => {
    const current = selection();
    return current ? definitionFromResults(props.groups, current.main.title) : undefined;
  });
  // A quoted found-document definition stays on screen while the dictionary is read (or read
  // again after a core swap): the preview changes text only when the dictionary has some.
  const shownText = (): string | undefined => definition.value() ?? fromResults()?.text;
  const hint = (): string => {
    const hit = primary();
    if (!hit) return '';
    if (hit.target.type === 'document') return 'документ в установленном наборе';
    if (!definitionHitHasText(hit)) return 'название сохранено, определения пока нет';
    if (definition.loading()) return '…';
    if (definition.error()) return 'не удалось прочитать словарь';
    if (!moduleFor(hit)) return 'этот выпуск словаря сейчас недоступен';
    return 'определение в словаре — откройте, чтобы скачать его';
  };

  const open = async (hit: CoreIdentityHit) => {
    if (!moduleFor(hit) || opening()) return;
    setError(undefined);
    if (hit.target.type === 'definition') {
      setSelected(hit);
      return;
    }
    setOpening(true);
    try {
      const target = hit.target;
      const local = await props.core.getDocument(target.documentId);
      if (disposed) return;
      if (local.ok) {
        assertIdentityDocumentTarget(local.value, target);
      } else if (local.error.code !== 'CONTENT_NOT_FOUND') {
        throw new Error(local.error.message);
      }
      openDocumentOverlay(target.documentId, target.anchor, {
        preferSummary: true,
        expectedIdentity: target,
      });
    } catch (cause) {
      if (!disposed)
        setError(cause instanceof Error ? cause.message : 'Не удалось открыть запись.');
    } finally {
      if (!disposed) setOpening(false);
    }
  };

  return (
    <Show when={selection()}>
      {(current) => (
        <section class="definition-preview" aria-label="Определение термина">
          <article class="definition-preview__card" data-testid="definition-preview">
            <p class="definition-preview__text">
              <Show
                when={shownText()}
                fallback={
                  <>
                    <strong class="definition-preview__term">{current().main.title}</strong>
                    <span class="definition-preview__hint"> — {hint()}</span>
                  </>
                }
              >
                {(text) => (
                  <Show
                    when={splitLeadingTerm(text(), current().main.title)}
                    fallback={
                      <>
                        <strong class="definition-preview__term">{current().main.title}</strong>
                        <span class="definition-preview__definition"> — {text()}</span>
                      </>
                    }
                  >
                    {(split) => (
                      <>
                        <strong class="definition-preview__term">{split().lead}</strong>
                        <span class="definition-preview__definition">{split().rest}</span>
                      </>
                    )}
                  </Show>
                )}
              </Show>
            </p>
            <div class="definition-preview__footer">
              <Show
                when={definition.value() ? undefined : fromResults()}
                fallback={
                  <span class="definition-preview__source">
                    {moduleFor(current().main.primary)?.title ??
                      (catalog.loading() ? 'Проверяем словарь…' : 'Словарь недоступен')}
                  </span>
                }
              >
                {(quoted) => (
                  <button
                    type="button"
                    class="definition-preview__source-link"
                    onClick={() =>
                      openDocumentOverlay(quoted().documentId, quoted().anchor, {
                        preferSummary: true,
                      })
                    }
                  >
                    из «{quoted().documentTitle}»
                  </button>
                )}
              </Show>
              <button
                type="button"
                class="definition-preview__action"
                disabled={!moduleFor(current().main.primary) || opening()}
                onClick={() => void open(current().main.primary)}
              >
                Подробнее
              </button>
              <Show when={current().main.others.length > 0}>
                <button
                  type="button"
                  class="definition-preview__action definition-preview__action--quiet"
                  aria-expanded={othersOpen()}
                  onClick={() => setOthersOpen((value) => !value)}
                >
                  ещё {current().main.others.length}{' '}
                  {current().main.primary.coverage === 'abbreviation'
                    ? pluralRu(current().main.others.length, 'значение', 'значения', 'значений')
                    : pluralRu(current().main.others.length, 'источник', 'источника', 'источников')}
                </button>
              </Show>
            </div>
            <Show when={othersOpen() && current().main.others.length > 0}>
              <ul class="definition-preview__others">
                <For each={current().main.others}>
                  {(hit) => (
                    <li class="definition-preview__other">
                      <button
                        type="button"
                        class="definition-preview__other-link"
                        disabled={!moduleFor(hit) || opening()}
                        onClick={() => void open(hit)}
                      >
                        {hit.title}
                      </button>
                      <span class="definition-preview__other-kind">
                        {COVERAGE_LABELS[hit.coverage] ?? 'запись'}
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </article>
          <Show when={current().also.length > 0}>
            <p class="definition-preview__also">
              <span class="definition-preview__also-label">Также в словаре:</span>
              <For each={current().also.slice(0, 4)}>
                {(group) => (
                  <button
                    type="button"
                    class="definition-preview__also-link"
                    disabled={!moduleFor(group.primary) || opening()}
                    onClick={() => void open(group.primary)}
                  >
                    {group.title}
                  </button>
                )}
              </For>
            </p>
          </Show>
          <Show when={catalog.error()}>
            <p class="definition-preview__error" role="alert">
              Не удалось прочитать каталог наборов.
            </p>
          </Show>
          <Show when={error()}>
            {(message) => (
              <p class="definition-preview__error" role="alert">
                {message()}
              </p>
            )}
          </Show>
          <Show when={selected()}>
            {(hit) => {
              const target = hit().target;
              if (target.type !== 'definition') return null;
              return (
                <OverlayDialog open title={hit().title} onClose={() => setSelected(undefined)}>
                  <DefinitionReferencePanel
                    core={props.core}
                    onContentChanged={props.onContentChanged}
                    catalog={runtime()?.getCatalog()}
                    initialCard={{
                      id: target.entityId,
                      moduleId: target.moduleId,
                      moduleVersion: target.moduleVersion,
                      editionId: target.editionId,
                    }}
                  />
                </OverlayDialog>
              );
            }}
          </Show>
        </section>
      )}
    </Show>
  );
}
