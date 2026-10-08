import type { CoreIdentityHit, MedicalCore, SearchResultGroup } from '@localmed/contracts';
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
import { OverlayDialog } from '@/components/OverlayDialog';
import { loadModuleCatalog } from '@/features/modules/module-catalog-state';
import { assertIdentityDocumentTarget } from '@/features/modules/module-pointer-install';
import { getContentModuleRuntime } from '@/features/modules/module-runtime-service';
import { DefinitionReferencePanel } from '@/features/reference/DefinitionReferencePanel';
import {
  type DoctorProfile,
  getDoctorProfile,
  noteDoctorField,
  subscribeDoctorProfile,
} from '@/features/reference/doctor-profile';
import {
  loadSenseDetails,
  type SenseDetail,
  type SenseSource,
} from '@/features/reference/sense-detail';
import { rankSenses, senseChips } from '@/features/reference/sense-ranking';
import { coreIdentityModule } from '@/features/search/core-identity-navigation';
import {
  definitionFromResults,
  definitionHitHasText,
  definitionPreviewText,
  selectDefinitionPreview,
  splitLeadingTerm,
} from '@/features/search/definition-preview';
import { subscribeAppPreferences } from '@/state/app-preferences';
import { openDocumentOverlay } from '@/state/document-navigation';
import { createQuietResource } from '@/state/quiet-resource';
import '@/features/search/core-identity-matches.css';

/** A sense opened in full counts for the doctor's profile less than a sense picked on purpose. */
const OPENED_WEIGHT = 0.5;

/** What a sense without a medical field is called on its chip. */
function plainSenseLabel(detail: SenseDetail): string {
  if (detail.card.coverage === 'gloss') return 'словарь';
  if (detail.card.kind === 'abbreviation') return 'сокращение';
  return 'другое';
}

/**
 * One definition above the results: «Термин — определение» in the source's own words, with the
 * source and a link to its exact place. A name several sources define differently shows the most
 * likely sense first (usage across all клинические рекомендации, source authority, the doctor's
 * own fields); the other senses are chips labelled by medical field, one tap away.
 */
export function CoreIdentityMatches(props: {
  readonly hits: readonly CoreIdentityHit[];
  readonly query: string;
  /** The search's own results: a found document's definition stands in when no dictionary text is at hand. */
  readonly groups: readonly SearchResultGroup[];
  readonly core: MedicalCore;
  readonly onContentChanged: () => Promise<void>;
}): JSX.Element {
  // Quiet resources: the card loads and reloads in place (a core swap, an install), never through
  // the page-level loader.
  const catalog = createQuietResource(loadModuleCatalog);
  const runtime = createMemo(() => {
    const value = catalog.value();
    return value ? getContentModuleRuntime(value) : undefined;
  });
  const [revision, setRevision] = createSignal(0);
  const [selected, setSelected] = createSignal<CoreIdentityHit>();
  const [opening, setOpening] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [chosen, setChosen] = createSignal<string>();
  const [profile, setProfile] = createSignal<DoctorProfile>(getDoctorProfile());
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const refresh = () => setRevision((value) => value + 1);
  onCleanup(subscribeAppPreferences(refresh));
  onCleanup(subscribeDoctorProfile(setProfile));
  createEffect(() => {
    const value = runtime();
    if (value) onCleanup(value.subscribe(refresh));
  });
  const moduleFor = (hit: CoreIdentityHit) => {
    revision();
    const value = runtime();
    return value ? coreIdentityModule(hit, value.getCatalog(), value.listInstalled()) : undefined;
  };
  const isInstalled = (hit: CoreIdentityHit): boolean => {
    const module = moduleFor(hit);
    return Boolean(
      module &&
        runtime()
          ?.listInstalled()
          .some(
            (entry) =>
              entry.moduleId === module.id &&
              entry.version === module.version &&
              entry.enabled &&
              entry.activeSourceSetDigest === module.sourceSetDigest,
          ),
    );
  };

  const selection = createMemo(() => selectDefinitionPreview(props.hits, props.query));
  const group = () => selection()?.main;
  const primary = () => group()?.primary;
  const senseTargets = createMemo(() => {
    const current = group();
    if (!current) return [];
    return [current.primary, ...current.others].flatMap((hit) => {
      const module = hit.target.type === 'definition' ? moduleFor(hit) : undefined;
      return module && definitionHitHasText(hit) ? [{ hit, module }] : [];
    });
  });
  // The key changes only when an entry becomes readable (a module finished installing), not on
  // every progress tick of a download.
  const sensesKey = createMemo(() => {
    const targets = senseTargets();
    if (!targets.length) return undefined;
    return targets
      .map(
        ({ hit, module }) =>
          `${hit.target.type === 'definition' ? hit.target.entityId : ''}|${module.id}@${module.version}|${isInstalled(hit)}`,
      )
      .join(',');
  });
  // The core is part of the source: after an install the registry swaps in a core that can read it.
  const [readFailed, setReadFailed] = createSignal(false);
  const details = createQuietResource(
    () => {
      const key = sensesKey();
      return key ? { key, core: props.core } : undefined;
    },
    async ({ core }) => {
      try {
        const loaded = await loadSenseDetails(core, senseTargets());
        setReadFailed(false);
        return loaded;
      } catch {
        // Shown in place as the card's hint; the previous senses stay on screen meanwhile.
        setReadFailed(true);
        return [];
      }
    },
  );
  const ranked = createMemo(() =>
    rankSenses(
      (details.value() ?? []).map((detail, order) => ({
        item: detail,
        sense: detail.sense,
        order,
      })),
      profile(),
    ),
  );
  const entityOf = (detail: SenseDetail): string =>
    detail.hit.target.type === 'definition' ? detail.hit.target.entityId : '';
  createEffect(
    on(
      () => group()?.key,
      () => setChosen(undefined),
      { defer: true },
    ),
  );
  const shown = createMemo(() => {
    const list = ranked();
    return (list.find((entry) => entityOf(entry.item) === chosen()) ?? list[0])?.item;
  });
  const chips = createMemo(() => {
    const current = shown();
    return senseChips(
      ranked(),
      (entry) => entry.item === current,
      (entry) => plainSenseLabel(entry.item),
    );
  });
  const fromResults = createMemo(() => {
    const current = selection();
    return current ? definitionFromResults(props.groups, current.main.title) : undefined;
  });
  const hint = (): string => {
    const hit = primary();
    if (!hit) return '';
    if (hit.target.type === 'document') return 'документ в установленном наборе';
    if (!definitionHitHasText(hit)) return 'название сохранено, определения пока нет';
    if (readFailed()) return 'не удалось прочитать словарь';
    if (details.loading()) return '';
    if (!moduleFor(hit)) return 'этот выпуск словаря сейчас недоступен';
    return 'определение в словаре, не загружено';
  };

  const chooseSense = (detail: SenseDetail) => {
    setChosen(entityOf(detail));
    if (detail.sense?.field) noteDoctorField(detail.sense.field);
  };

  const openSource = (source: SenseSource) => {
    const link = source.link;
    if (link?.kind !== 'document') return;
    const field = shown()?.sense?.field;
    if (field) noteDoctorField(field, OPENED_WEIGHT);
    openDocumentOverlay(link.documentId, link.anchor, { preferSummary: true });
  };

  const open = async (hit: CoreIdentityHit) => {
    if (!moduleFor(hit) || opening()) return;
    setError(undefined);
    if (hit.target.type === 'definition') {
      const field = shown()?.sense?.field;
      if (field) noteDoctorField(field, OPENED_WEIGHT);
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
  const detailsTarget = (): CoreIdentityHit | undefined => shown()?.hit ?? primary();

  return (
    <Show when={selection()}>
      {(current) => (
        <section class="definition-preview" aria-label="Определение термина">
          <article class="definition-preview__card" data-testid="definition-preview">
            <Show
              when={shown()}
              keyed
              fallback={
                <FallbackText
                  title={current().main.title}
                  hint={hint()}
                  quoted={fromResults()}
                  loading={details.loading()}
                />
              }
            >
              {(detail) => <DefinitionText text={detail.text} title={current().main.title} />}
            </Show>
            <div class="definition-preview__footer">
              <Show
                when={shown()}
                keyed
                fallback={
                  <Show when={fromResults()}>
                    {(quoted) => (
                      <div class="definition-preview__source-row">
                        <button
                          type="button"
                          class="definition-preview__source-link"
                          onClick={() =>
                            openDocumentOverlay(quoted().documentId, quoted().anchor, {
                              preferSummary: true,
                            })
                          }
                        >
                          <span class="definition-preview__source-name">
                            {quoted().documentTitle}
                          </span>
                          <AppGlyph
                            name="arrow-square-out"
                            class="definition-preview__source-icon"
                          />
                        </button>
                      </div>
                    )}
                  </Show>
                }
              >
                {(detail) => (
                  <div class="definition-preview__source-row">
                    <SourceLine source={detail.source} onOpen={openSource} />
                    <Show when={!detail.source.official}>
                      <span class="definition-preview__badge">черновик</span>
                    </Show>
                  </div>
                )}
              </Show>
              <button
                type="button"
                class="definition-preview__more"
                aria-label="Подробнее"
                disabled={!moduleFor(current().main.primary) || opening()}
                onClick={() => {
                  const target = detailsTarget();
                  if (target) void open(target);
                }}
              >
                <AppGlyph name="caret-right" class="definition-preview__more-icon" />
              </button>
            </div>
            <Show when={chips().length > 0}>
              <ul class="definition-preview__senses" aria-label="Другие значения">
                <For each={chips()}>
                  {(chip) => (
                    <li class="definition-preview__sense-item">
                      <button
                        type="button"
                        class="definition-preview__sense"
                        onClick={() => chooseSense(chip.entry.item)}
                      >
                        {chip.label}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </article>
          <Show when={current().also.length > 0}>
            <p class="definition-preview__also">
              <For each={current().also.slice(0, 3)}>
                {(other) => (
                  <button
                    type="button"
                    class="definition-preview__also-link"
                    disabled={!moduleFor(other.primary) || opening()}
                    onClick={() => void open(other.primary)}
                  >
                    {other.title}
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

/** «Термин — начало определения»; a definition that opens with its own term keeps that opening. */
function DefinitionText(props: { readonly text: string; readonly title: string }): JSX.Element {
  const preview = () => definitionPreviewText(props.text);
  return (
    <p class="definition-preview__text">
      <Show
        when={splitLeadingTerm(preview(), props.title)}
        fallback={
          <>
            <strong class="definition-preview__term">{props.title}</strong>
            <span class="definition-preview__definition"> — {preview()}</span>
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
    </p>
  );
}

function FallbackText(props: {
  readonly title: string;
  readonly hint: string;
  readonly quoted: { readonly text: string } | undefined;
  readonly loading: boolean;
}): JSX.Element {
  return (
    <Show
      when={props.quoted}
      fallback={
        <p
          class="definition-preview__text"
          classList={{ 'definition-preview__text--quiet': props.loading }}
        >
          <strong class="definition-preview__term">{props.title}</strong>
          <Show when={props.hint}>
            <span class="definition-preview__hint"> — {props.hint}</span>
          </Show>
        </p>
      }
    >
      {(quoted) => <DefinitionText text={quoted().text} title={props.title} />}
    </Show>
  );
}

function SourceLine(props: {
  readonly source: SenseSource;
  readonly onOpen: (source: SenseSource) => void;
}): JSX.Element {
  const label = () => (
    <>
      <span class="definition-preview__source-name">{props.source.label}</span>
      <AppGlyph name="arrow-square-out" class="definition-preview__source-icon" />
    </>
  );
  return (
    <Show
      when={props.source.link}
      fallback={<span class="definition-preview__source">{props.source.label}</span>}
    >
      {(link) => {
        const target = link();
        return target.kind === 'web' ? (
          <a
            class="definition-preview__source-link"
            href={target.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Открыть в источнике: ${props.source.label}`}
          >
            {label()}
          </a>
        ) : (
          <button
            type="button"
            class="definition-preview__source-link"
            aria-label={`Открыть в источнике: ${props.source.label}`}
            onClick={() => props.onOpen(props.source)}
          >
            {label()}
          </button>
        );
      }}
    </Show>
  );
}
