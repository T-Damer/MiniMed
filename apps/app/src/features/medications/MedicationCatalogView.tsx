import type { MedicalCore, MedicalDocument } from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

import { AppGlyph } from '@/components/AppGlyph';
import { CountBadge } from '@/components/CountBadge';
import { DocumentText } from '@/components/DocumentText';
import { QueryHighlightedText } from '@/components/HighlightedText';
import { stripKnownHtmlMarkupInline } from '@/components/html-markup';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { NavBack } from '@/components/NavBack';
import { SearchField } from '@/components/SearchField';
import {
  displayDocumentSubtitle,
  displayDocumentTitle,
  documentSectionHeadingTag,
  orderDocumentSections,
  sourceTypeReaderLabel,
} from '@/features/library/document-display';
import { rankMedicationCatalog } from '@/features/medications/medication-catalog-search';
import {
  documentFromSummary,
  processMedicationSummariesInBatches,
  shouldHideMedicationCatalog,
  shouldPreserveMedicationCatalog,
} from '@/features/medications/medication-loading';
import {
  type MedicationProduct,
  medicationDocumentRegistration,
  parseAllmedMedicationProduct,
  parseMedicationProduct,
} from '@/features/medications/medication-record';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { openDocumentOverlay } from '@/state/document-navigation';

interface MedicationCatalogViewProps {
  readonly core: MedicalCore;
  readonly onBack: () => void;
}

interface PackageVariant {
  readonly key: string;
  readonly dosageForm: string;
  readonly strength: string | null;
  readonly description: string;
  readonly prescriptionStatus: string | null;
}

const ROUTE_PREFIX = 'modules/documents/medications/';
const STICKY_BLUR_OFFSET_PX = 12;

function selectedRegistrationFromLocation(): string | null {
  const route = window.location.hash.replace(/^#\/?/u, '');
  if (!route.startsWith(ROUTE_PREFIX)) return null;
  try {
    return decodeURIComponent(route.slice(ROUTE_PREFIX.length)) || null;
  } catch {
    return null;
  }
}

function packageTitle(description: string): string {
  return description.split(/\s+-\s+/u, 1)[0] || description;
}

function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

// Allmed source markdown always opens with a "Карточка препарата" section whose body is just the
// trade name and Latin name again — already shown in the header above and the page hero. Drop it
// instead of rendering a section that duplicates the title.
const REDUNDANT_TITLE_SECTION = 'Карточка препарата';

function MedicationSourceContent(props: {
  readonly sourceDocument: MedicalDocument;
  readonly searchQuery: string;
}): JSX.Element {
  const sections = orderDocumentSections(
    props.sourceDocument.sections,
    props.sourceDocument.sourceType,
  ).filter((section) => section.chunks.length > 0 && section.title !== REDUNDANT_TITLE_SECTION);
  const sourceQuery = createMemo(() => normalizeSearch(props.searchQuery));
  const [activeMatch, setActiveMatch] = createSignal(0);
  const [matchCount, setMatchCount] = createSignal(0);
  let sourceRoot: HTMLElement | undefined;
  const matchElements = (): HTMLElement[] =>
    sourceRoot
      ? Array.from(sourceRoot.querySelectorAll<HTMLElement>('.medication-source__match'))
      : [];

  createEffect(() => {
    sourceQuery();
    setActiveMatch(0);
  });
  createEffect(() => {
    sourceQuery();
    const requestedIndex = activeMatch();
    const matches = matchElements();
    setMatchCount(matches.length);
    const nextIndex = matches.length > 0 ? Math.min(requestedIndex, matches.length - 1) : 0;
    if (nextIndex !== requestedIndex) {
      setActiveMatch(nextIndex);
      return;
    }
    matches.forEach((match, index) => {
      match.classList.toggle('medication-source__match--active', index === nextIndex);
    });
  });

  const moveMatch = (direction: -1 | 1): void => {
    const matches = matchElements();
    if (matches.length === 0) return;
    const nextIndex = (activeMatch() + direction + matches.length) % matches.length;
    setActiveMatch(nextIndex);
    matches[nextIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const scrollToSection = (anchor: string): void => {
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section ref={sourceRoot} class="medication-source paper-card">
      <header class="medication-source__header">
        <Show when={sourceTypeReaderLabel(props.sourceDocument.sourceType)}>
          {(label) => <p class="medication-source__label">{label()}</p>}
        </Show>
        <h2 class="medication-source__title">
          <QueryHighlightedText
            text={displayDocumentTitle(props.sourceDocument)}
            query={sourceQuery()}
            exact
            matchClass="medication-source__match"
          />
        </h2>
        <Show when={displayDocumentSubtitle(props.sourceDocument)}>
          {(subtitle) => <p class="medication-source__subtitle">{subtitle()}</p>}
        </Show>
      </header>

      <Show when={sourceQuery()}>
        <div class="medication-source__find-toolbar">
          <span class="medication-source__find-count" aria-live="polite">
            {matchCount() > 0 ? `${activeMatch() + 1} из ${matchCount()}` : '0 совпадений'}
          </span>
          <div class="medication-source__find-actions">
            <button
              type="button"
              class="medication-source__find-button"
              aria-label="Предыдущее совпадение"
              title="Предыдущее совпадение"
              disabled={matchCount() === 0}
              onClick={() => moveMatch(-1)}
            >
              <AppGlyph name="arrow-up" class="medication-source__find-icon" />
            </button>
            <button
              type="button"
              class="medication-source__find-button"
              aria-label="Следующее совпадение"
              title="Следующее совпадение"
              disabled={matchCount() === 0}
              onClick={() => moveMatch(1)}
            >
              <AppGlyph
                name="arrow-up"
                class="medication-source__find-icon medication-source__find-icon--down"
              />
            </button>
          </div>
        </div>
      </Show>

      <details class="medication-source__outline" open>
        <summary class="medication-source__outline-summary">Оглавление</summary>
        <nav class="medication-source__outline-list" aria-label="Разделы карточки препарата">
          <For each={sections}>
            {(section, index) => (
              <button
                type="button"
                class="medication-source__outline-button"
                onClick={() => scrollToSection(section.anchor)}
              >
                <span class="medication-source__outline-number">
                  {String(index() + 1).padStart(2, '0')}
                </span>
                <span class="medication-source__outline-title">{section.title}</span>
              </button>
            )}
          </For>
        </nav>
      </details>

      <div class="medication-source__sections">
        <For each={sections}>
          {(section, index) => (
            <section
              class="medication-source__section"
              classList={{
                'medication-source__section--separated': index() > 0 && section.depth === 0,
              }}
              id={section.anchor}
            >
              <Dynamic
                component={documentSectionHeadingTag(section.depth, 2)}
                class={`medication-source__section-title medication-source__section-title--${documentSectionHeadingTag(section.depth, 2)}`}
              >
                <QueryHighlightedText
                  text={section.title}
                  query={sourceQuery()}
                  exact
                  matchClass="medication-source__match"
                />
              </Dynamic>
              <For each={section.chunks}>
                {(chunk) => (
                  <DocumentText
                    text={chunk.originalText}
                    paragraphClass="medication-source__paragraph"
                    query={sourceQuery()}
                    exactQuery
                    highlightClass="medication-source__match"
                  />
                )}
              </For>
            </section>
          )}
        </For>
      </div>
    </section>
  );
}

function productVariants(product: MedicationProduct): readonly PackageVariant[] {
  return product.presentations.flatMap((presentation, presentationIndex) =>
    presentation.packages.map((item, packageIndex) => ({
      key: `${presentationIndex}-${packageIndex}`,
      dosageForm: stripKnownHtmlMarkupInline(presentation.dosageForm),
      strength: presentation.strength,
      description: stripKnownHtmlMarkupInline(item.description),
      prescriptionStatus: item.prescriptionStatus ?? product.prescriptionStatus,
    })),
  );
}

function toProducts(
  documents: readonly MedicalDocument[],
  instructions: ReadonlyMap<string, string>,
): readonly MedicationProduct[] {
  const registryProducts = documents
    .filter((document) => document.sourceType === 'official_registry_summary')
    .flatMap((document) => {
      const registration = medicationDocumentRegistration(document);
      const product = parseMedicationProduct(
        document,
        registration ? (instructions.get(registration) ?? null) : null,
      );
      return product ? [product] : [];
    });
  const allmedProducts = documents.flatMap((document) => {
    const product = parseAllmedMedicationProduct(document);
    return product ? [product] : [];
  });
  return [...registryProducts, ...allmedProducts];
}

/**
 * Loads the medication catalog progressively: instruction documents are resolved first (needed to
 * cross-reference registry entries), then registry/allmed documents stream in batches so the list
 * can render as data arrives instead of blocking on the full ~4700-document catalog.
 */
async function loadProducts(
  core: MedicalCore,
  onUpdate: (products: readonly MedicationProduct[]) => void,
): Promise<readonly MedicationProduct[]> {
  const summaries = await core.listDocuments();
  if (!summaries.ok) throw new Error(summaries.error.message);
  const medicationSummaries = summaries.value.filter((document) =>
    ['allmed_reference', 'official_drug_instruction', 'official_registry_summary'].includes(
      document.sourceType,
    ),
  );
  const instructionSummaries = medicationSummaries.filter(
    (document) => document.sourceType === 'official_drug_instruction',
  );
  const otherSummaries = medicationSummaries.filter(
    (document) => document.sourceType !== 'official_drug_instruction',
  );

  const instructions = new Map(
    instructionSummaries.flatMap((summary) => {
      const document = documentFromSummary(summary);
      if (!document) return [];
      const registration = medicationDocumentRegistration(document);
      return registration ? [[registration, document.id] as const] : [];
    }),
  );

  let accumulated: readonly MedicationProduct[] = [];
  await processMedicationSummariesInBatches(otherSummaries, (batchDocuments) => {
    accumulated = accumulated.concat(toProducts(batchDocuments, instructions));
    onUpdate(accumulated);
  });
  return [...accumulated].toSorted((left, right) =>
    left.tradeName.localeCompare(right.tradeName, 'ru'),
  );
}

export function MedicationCatalogView(props: MedicationCatalogViewProps): JSX.Element {
  const initialSelectedRegistration = selectedRegistrationFromLocation();
  const [products, setProducts] = createSignal<readonly MedicationProduct[]>([]);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [sourceSearchQuery, setSourceSearchQuery] = createSignal('');
  const [selectedRegistration, setSelectedRegistration] = createSignal(initialSelectedRegistration);
  const [catalogVisited, setCatalogVisited] = createSignal(initialSelectedRegistration === null);
  const [selectedVariant, setSelectedVariant] = createSignal(0);
  const [sourceDocument, setSourceDocument] = createSignal<MedicalDocument>();
  const [sourceDocumentLoading, setSourceDocumentLoading] = createSignal(false);
  const [sourceDocumentError, setSourceDocumentError] = createSignal<string>();
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>();
  let sourceDocumentId = '';
  let medicationPageRoot: HTMLElement | undefined;
  let stickyLayoutFrame: number | undefined;

  const updateStickyLayout = (): void => {
    const root = medicationPageRoot;
    if (!root) return;
    const routeHeading = root.querySelector<HTMLElement>('.medication-route-heading');
    if (!routeHeading) return;

    const routeHeight = Math.ceil(routeHeading.offsetHeight);
    const sourceHeader = root.querySelector<HTMLElement>('.medication-source__header');
    const sourceHeight = sourceHeader ? Math.ceil(sourceHeader.offsetHeight) : 0;
    const sectionTitles = Array.from(
      root.querySelectorAll<HTMLElement>('.medication-source__section-title'),
    );
    root.style.setProperty('--medication-source-header-top', `${routeHeight}px`);
    root.style.setProperty('--medication-section-title-top', `${routeHeight + sourceHeight}px`);

    const stickyElements = [
      routeHeading,
      ...(sourceHeader ? [sourceHeader] : []),
      ...sectionTitles,
    ];
    const stickyStates = stickyElements.map((element) => {
      const rect = element.getBoundingClientRect();
      const stickyTop = Number.parseFloat(getComputedStyle(element).top);
      return {
        element,
        isSticky:
          window.scrollY > 1 && Number.isFinite(stickyTop) && Math.abs(rect.top - stickyTop) <= 1,
        bottom: rect.bottom,
      };
    });
    routeHeading.classList.toggle('sticky-surface--stuck', stickyStates[0]?.isSticky ?? false);
    stickyStates.forEach((state, index) => {
      const hasStickyAbove = stickyStates.slice(0, index).some((candidate) => candidate.isSticky);
      state.element.classList.toggle(
        'medication-page__sticky-item--stacked',
        state.isSticky && hasStickyAbove,
      );
    });
    const stickyBottoms = stickyStates
      .filter((state) => state.isSticky)
      .map((state) => state.bottom);
    const blurHeight = stickyBottoms.length
      ? Math.max(...stickyBottoms) + STICKY_BLUR_OFFSET_PX
      : 0;
    root.style.setProperty('--medication-sticky-blur-height', `${Math.ceil(blurHeight)}px`);
    root.style.setProperty('--medication-sticky-blur-opacity', stickyBottoms.length ? '1' : '0');
  };

  const scheduleStickyLayout = (): void => {
    if (stickyLayoutFrame !== undefined) cancelAnimationFrame(stickyLayoutFrame);
    stickyLayoutFrame = requestAnimationFrame(() => {
      stickyLayoutFrame = undefined;
      updateStickyLayout();
    });
  };

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    setProducts([]);
    let firstBatchSeen = false;
    try {
      const complete = await loadProducts(props.core, (next) => {
        setProducts(next);
        if (!firstBatchSeen) {
          firstBatchSeen = true;
          setLoading(false);
        }
      });
      setProducts(complete);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть базу препаратов.');
    } finally {
      setLoading(false);
    }
  };
  const syncRoute = (): void => {
    const nextRegistration = selectedRegistrationFromLocation();
    setSelectedRegistration(nextRegistration);
    if (nextRegistration === null) setCatalogVisited(true);
    setSelectedVariant(0);
    setSourceSearchQuery('');
  };

  onMount(() => {
    void refresh();
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener(CONTENT_CHANGED_EVENT, refresh);
    window.addEventListener('scroll', scheduleStickyLayout, { passive: true });
    window.addEventListener('resize', scheduleStickyLayout);
    scheduleStickyLayout();
    if (medicationPageRoot && typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(scheduleStickyLayout);
      resizeObserver.observe(medicationPageRoot);
      onCleanup(() => resizeObserver.disconnect());
    }
  });
  onCleanup(() => {
    window.removeEventListener('hashchange', syncRoute);
    window.removeEventListener(CONTENT_CHANGED_EVENT, refresh);
    window.removeEventListener('scroll', scheduleStickyLayout);
    window.removeEventListener('resize', scheduleStickyLayout);
    if (stickyLayoutFrame !== undefined) cancelAnimationFrame(stickyLayoutFrame);
  });

  const selectedProduct = createMemo(() =>
    products().find((product) => product.registrationNumber === selectedRegistration()),
  );
  const visibleProducts = createMemo(() => rankMedicationCatalog(products(), searchQuery()));

  createEffect(() => {
    selectedProduct();
    setSelectedVariant(0);
  });

  createEffect(() => {
    const product = selectedProduct();
    const nextDocumentId = product?.instructionDocumentId ?? product?.registrationDocumentId ?? '';
    if (nextDocumentId === sourceDocumentId) return;
    sourceDocumentId = nextDocumentId;
    setSourceDocument(undefined);
    setSourceDocumentError(undefined);
    if (!nextDocumentId) {
      setSourceDocumentLoading(false);
      return;
    }
    setSourceDocumentLoading(true);
    void props.core
      .getDocument(nextDocumentId)
      .then((result) => {
        if (sourceDocumentId !== nextDocumentId) return;
        if (result.ok) setSourceDocument(result.value);
        else setSourceDocumentError(result.error.message);
      })
      .catch((cause: unknown) => {
        if (sourceDocumentId !== nextDocumentId) return;
        setSourceDocumentError(
          cause instanceof Error ? cause.message : 'Не удалось загрузить содержание карточки.',
        );
      })
      .finally(() => {
        if (sourceDocumentId === nextDocumentId) setSourceDocumentLoading(false);
      });
  });

  createEffect(() => {
    sourceDocument();
    scheduleStickyLayout();
  });

  const openProduct = (product: MedicationProduct): void => {
    window.location.hash = `#/modules/documents/medications/${encodeURIComponent(
      product.registrationNumber,
    )}`;
  };
  const back = (): void => {
    if (selectedRegistration()) {
      window.location.hash = '#/modules/documents/medications';
      return;
    }
    props.onBack();
  };

  return (
    <section ref={medicationPageRoot} class="medication-page">
      <div class="medication-page__sticky-blur masked-backdrop-blur" aria-hidden="true" />
      <div class="knowledge-subroute-heading knowledge-subroute-heading--blurred medication-route-heading route-sticky-chrome">
        <NavBack
          class="knowledge-back-button knowledge-subroute-heading__control"
          aria-label="Назад"
          onClick={back}
        />
        <Show when={selectedRegistration()}>
          <h1 class="medication-route-heading__title knowledge-subroute-heading__control">
            {selectedProduct()?.tradeName}
          </h1>
          <SearchField
            class="route-search medication-route-heading__search knowledge-subroute-heading__control"
            value={sourceSearchQuery()}
            onInput={setSourceSearchQuery}
            id="medication-source-search"
            label="Поиск в карточке препарата"
            hideLabel
            placeholder="Поиск в карточке"
          />
        </Show>
        <Show when={!selectedRegistration()}>
          <SearchField
            class="route-search knowledge-subroute-heading__control"
            value={searchQuery()}
            onInput={setSearchQuery}
            label="Поиск по препаратам"
            hideLabel
            placeholder="Название, МНН или показание"
          />
        </Show>
      </div>

      <Show when={shouldPreserveMedicationCatalog(catalogVisited(), selectedRegistration())}>
        <section
          class="medication-catalog-section"
          classList={{
            'medication-catalog-section--hidden': shouldHideMedicationCatalog(
              selectedRegistration(),
            ),
          }}
          aria-hidden={shouldHideMedicationCatalog(selectedRegistration())}
          hidden={shouldHideMedicationCatalog(selectedRegistration())}
        >
          <div class="module-collection-heading">
            <h2 class="module-collection-heading__title">Препараты</h2>
            <CountBadge value={products().length} />
          </div>
          <Show when={loading()}>
            <div class="medication-empty paper-card" role="status">
              Открываем локальную базу…
            </div>
          </Show>
          <Show when={error()}>
            {(message) => (
              <div class="error-card" role="alert">
                {message()}
              </div>
            )}
          </Show>
          <div class="medication-grid">
            <LayoutVirtualizedGrid data={visibleProducts()} bufferSize={500}>
              {(product) => {
                const variants = () => productVariants(product);
                const description = () =>
                  stripKnownHtmlMarkupInline(product.presentations[0]?.dosageForm ?? '');
                return (
                  <button
                    type="button"
                    class="medication-product-card paper-card"
                    onClick={() => openProduct(product)}
                  >
                    <AppGlyph name="arrow-up-right" class="medication-product-card__open-icon" />
                    <strong class="medication-product-card__title">{product.tradeName}</strong>
                    <p class="medication-product-card__inn">{product.inn}</p>
                    <div class="medication-product-card__summary">
                      <span class="medication-product-card__description">{description()}</span>
                    </div>
                    <p class="medication-product-card-meta">
                      {product.registrationStatus} · {variants().length} вариантов упаковки
                    </p>
                  </button>
                );
              }}
            </LayoutVirtualizedGrid>
          </div>
        </section>
      </Show>

      <Show when={selectedProduct()}>
        {(product) => {
          const variants = createMemo(() => productVariants(product()));
          const current = createMemo(() => variants()[selectedVariant()] ?? variants()[0]);
          return (
            <article class="medication-detail">
              <header class="medication-hero paper-card">
                <div>
                  <span class="medication-detail__state">{product().registrationStatus}</span>
                  <p class="medication-detail__inn">{product().inn}</p>
                  <div class="medication-detail__tags">
                    <For each={product().pharmacotherapeuticGroups}>
                      {(group) => <span class="medication-detail__tag">{group}</span>}
                    </For>
                  </div>
                </div>
                <Show when={product().instructionDocumentId}>
                  {(documentId) => (
                    <button type="button" onClick={() => openDocumentOverlay(documentId())}>
                      <AppGlyph name="book-open" />
                      {product().sourceKind === 'allmed'
                        ? 'Открыть карточку'
                        : 'Открыть инструкцию'}
                    </button>
                  )}
                </Show>
              </header>

              <Show when={current()}>
                {(variant) => (
                  <section class="medication-current-form paper-card">
                    <p class="archive-kicker">Выбранная форма и упаковка</p>
                    <h2>{packageTitle(variant().description)}</h2>
                    <dl>
                      <div>
                        <dt>Лекарственная форма</dt>
                        <dd>{variant().dosageForm}</dd>
                      </div>
                      <div>
                        <dt>Концентрация</dt>
                        <dd>{variant().strength ?? 'Не указана'}</dd>
                      </div>
                      <div>
                        <dt>Упаковка</dt>
                        <dd>{variant().description}</dd>
                      </div>
                      <div>
                        <dt>Отпуск</dt>
                        <dd>{variant().prescriptionStatus ?? 'Не указан'}</dd>
                      </div>
                    </dl>
                  </section>
                )}
              </Show>

              <Show when={sourceDocumentLoading()}>
                <div class="medication-source-status paper-card" role="status">
                  Загружаем содержание карточки…
                </div>
              </Show>
              <Show when={sourceDocumentError()}>
                {(message) => (
                  <div
                    class="medication-source-status medication-source-status--error"
                    role="alert"
                  >
                    {message()}
                  </div>
                )}
              </Show>
              <Show when={sourceDocument()}>
                {(document) => (
                  <MedicationSourceContent
                    sourceDocument={document()}
                    searchQuery={sourceSearchQuery()}
                  />
                )}
              </Show>

              <section class="medication-section">
                <h2 class="medication-section__title">Другие формы и упаковки</h2>
                <div class="medication-variant-grid">
                  <For each={variants()}>
                    {(variant, index) => (
                      <button
                        type="button"
                        class="medication-variant-card paper-card"
                        classList={{ active: selectedVariant() === index() }}
                        aria-pressed={selectedVariant() === index()}
                        onClick={() => setSelectedVariant(index())}
                      >
                        <strong class="medication-variant-card__title">
                          {packageTitle(variant.description)}
                        </strong>
                        <span class="medication-variant-card__form">{variant.dosageForm}</span>
                        <small class="medication-variant-card__description">
                          {variant.description}
                        </small>
                      </button>
                    )}
                  </For>
                </div>
              </section>

              <section class="medication-registry paper-card">
                <h2 class="medication-registry__title">Регистрационные данные</h2>
                <dl class="medication-registry__details">
                  <div class="medication-registry__detail">
                    <dt class="medication-registry__label">Регистрационное удостоверение</dt>
                    <dd class="medication-registry__value">{product().registrationNumber}</dd>
                  </div>
                  <div class="medication-registry__detail">
                    <dt class="medication-registry__label">Дата регистрации</dt>
                    <dd class="medication-registry__value">
                      {product().registrationDate ?? 'Не указана'}
                    </dd>
                  </div>
                  <div class="medication-registry__detail">
                    <dt class="medication-registry__label">Держатель</dt>
                    <dd class="medication-registry__value">{product().holder ?? 'Не указан'}</dd>
                  </div>
                  <div class="medication-registry__detail">
                    <dt class="medication-registry__label">Производитель</dt>
                    <dd class="medication-registry__value">
                      {product().manufacturer ?? 'Не указан'}
                    </dd>
                  </div>
                </dl>
              </section>

              <section class="medication-section">
                <h2 class="medication-section__title">Похожие</h2>
                <div class="medication-empty paper-card">Похожие препараты пока не рассчитаны.</div>
              </section>
            </article>
          );
        }}
      </Show>

      <Show when={selectedRegistration() && !loading() && !selectedProduct()}>
        <div class="medication-empty paper-card">Препарат не найден в локальной базе.</div>
      </Show>
    </section>
  );
}
