import type { MedicalCore, MedicalDocument } from '@localmed/contracts';
import {
  createDeferred,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  lazy,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { PAGE_HEROES } from '@/app/page-heroes';
import { AppGlyph } from '@/components/AppGlyph';
import { CountBadge } from '@/components/CountBadge';
import { stripKnownHtmlMarkupInline } from '@/components/html-markup';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { useStickySurface } from '@/components/sticky-surface';
import { Heading } from '@/components/Text';
import { type AtcSubstance, atcSubstanceFromDocument } from '@/features/medications/atc-tree';
import {
  displayDrugName,
  displayStrength,
  instructionIndexFromSummaries,
  instructionSourceClassIndexFromSummaries,
} from '@/features/medications/drug-screen';
import type { InstructionSourceClass } from '@/features/medications/instruction-source';
import { MedicationDownloadState } from '@/features/medications/MedicationDownloadState';
import { rankMedicationCatalogSliced } from '@/features/medications/medication-catalog-search';
import { processMedicationSummariesInBatches } from '@/features/medications/medication-loading';
import {
  consumeMedicationCatalogQuery,
  openMedicationProduct,
} from '@/features/medications/medication-navigation';
import {
  composeMedicationProducts,
  type MedicationPackage,
  type MedicationProduct,
  medicationDocumentRegistration,
  parseAllmedMedicationProduct,
  parseEsklpMedicationProducts,
  parseMedicationProduct,
} from '@/features/medications/medication-record';
import {
  isMedicationCatalogRoute,
  legacyMedicationRegistrationFromHash,
  MEDICATION_ATC_HASH,
  MEDICATION_CATALOG_HASH,
  medicationCatalogViewFromHash,
} from '@/features/medications/medication-routing';
import {
  countryMarkText,
  manufacturingBasis,
  manufacturingBasisTitle,
  manufacturingCountries,
} from '@/features/medications/mfg-country';
import { useMfgCountries } from '@/features/medications/use-mfg-countries';
import { pluralRu } from '@/i18n/labels';
import { replaceRoute } from '@/state/app-back';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';

const MedicationAtcTree = lazy(() =>
  import('@/features/medications/MedicationAtcTree').then((module) => ({
    default: module.MedicationAtcTree,
  })),
);

type CatalogViewMode = 'list' | 'atc';

interface MedicationCatalogViewProps {
  readonly core: MedicalCore;
  readonly onBack: () => void;
  /** Reconnects the core after packages are installed; falls back to the content event. */
  readonly onContentChanged?: () => Promise<void>;
}

interface MedicationSummaryMetadata extends Readonly<Record<string, unknown>> {
  readonly contentMode?: unknown;
}

function metadataContentMode(metadata: MedicalDocument['metadata'] | undefined): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const contentMode = (metadata as MedicationSummaryMetadata).contentMode;
  return typeof contentMode === 'string' ? contentMode : null;
}

interface ParsedMedicationProducts {
  readonly registry: readonly MedicationProduct[];
  readonly allmed: readonly MedicationProduct[];
  /** ЕСКЛП substance cards, for the «По группам АТХ» view. */
  readonly substances: readonly AtcSubstance[];
}

function parseProducts(
  documents: readonly MedicalDocument[],
  instructions: ReadonlyMap<string, string>,
  instructionSourceClasses: ReadonlyMap<string, InstructionSourceClass>,
): ParsedMedicationProducts {
  const registry: MedicationProduct[] = [];
  const allmed: MedicationProduct[] = [];
  const substances: AtcSubstance[] = [];
  for (const document of documents) {
    if (metadataContentMode(document.metadata) === 'esklp-mnn') {
      const substance = atcSubstanceFromDocument(document);
      if (substance) substances.push(substance);
      registry.push(
        ...parseEsklpMedicationProducts(document, instructions, instructionSourceClasses),
      );
      continue;
    }
    if (document.sourceType === 'official_registry_summary') {
      const registration = medicationDocumentRegistration(document);
      const product = parseMedicationProduct(
        document,
        registration ? (instructions.get(registration) ?? null) : null,
      );
      if (product) registry.push(product);
      continue;
    }
    const product = parseAllmedMedicationProduct(document);
    if (product) allmed.push(product);
  }
  return { registry, allmed, substances };
}

function medicationProductKey(product: MedicationProduct): string {
  return [
    product.sourceKind,
    product.registrationDocumentId,
    product.mnnDocumentId ?? '',
    product.registrationNumber,
    product.tradeName,
    product.inn,
    product.smnnCode ?? '',
    ...product.smnnCodes,
    ...product.presentations.flatMap((presentation) => [
      presentation.dosageForm,
      presentation.strength ?? '',
      presentation.route ?? '',
    ]),
  ].join('\u001f');
}

function addProducts(
  target: Map<string, MedicationProduct>,
  products: readonly MedicationProduct[],
): void {
  for (const product of products) {
    target.set(medicationProductKey(product), product);
  }
}

const catalogCollator = new Intl.Collator('ru');

function sortProducts(products: readonly MedicationProduct[]): readonly MedicationProduct[] {
  return products.toSorted((left, right) => {
    const leftForm = left.presentations[0]?.dosageForm ?? '';
    const rightForm = right.presentations[0]?.dosageForm ?? '';
    return (
      catalogCollator.compare(left.tradeName, right.tradeName) ||
      catalogCollator.compare(left.registrationNumber, right.registrationNumber) ||
      catalogCollator.compare(leftForm, rightForm)
    );
  });
}

function toProducts(
  registryProducts: ReadonlyMap<string, MedicationProduct>,
  allmedProducts: ReadonlyMap<string, MedicationProduct>,
): readonly MedicationProduct[] {
  return sortProducts(
    composeMedicationProducts([...registryProducts.values()], [...allmedProducts.values()]),
  );
}

function isMedicationSummary(
  metadata: MedicalDocument['metadata'] | undefined,
  sourceType: string,
): boolean {
  if (sourceType === 'allmed_reference' || sourceType === 'official_drug_instruction') return true;
  if (sourceType === 'official_registry_summary') return true;
  return metadataContentMode(metadata) === 'esklp-mnn';
}

function productDescription(product: MedicationProduct): string {
  const presentation = product.presentations[0];
  return stripKnownHtmlMarkupInline(
    product.shortDescription ??
      product.supplementalDescription ??
      [
        presentation?.dosageForm ? displayDrugName(presentation.dosageForm) : null,
        presentation?.strength ? displayStrength(presentation.strength) : null,
      ]
        .filter(Boolean)
        .join(' · '),
  );
}

/**
 * Loads the medication catalog progressively: instruction documents are resolved first (needed to
 * cross-reference registry entries), then registry/allmed documents stream in batches so the list
 * can render as data arrives instead of blocking on the full ~4700-document catalog.
 */
async function loadProducts(
  core: MedicalCore,
  signal: AbortSignal,
  onUpdate: (products: readonly MedicationProduct[], substances: readonly AtcSubstance[]) => void,
): Promise<{
  readonly products: readonly MedicationProduct[];
  readonly substances: readonly AtcSubstance[];
}> {
  const listNavigation = core.listNavigationDocuments?.bind(core);
  const getSummary = listNavigation && core.getDocumentSummary?.bind(core);
  const summaries = await (getSummary && listNavigation ? listNavigation() : core.listDocuments());
  if (signal.aborted) return { products: [], substances: [] };
  if (!summaries.ok) throw new Error(summaries.error.message);
  const medicationSummaries = summaries.value.filter((document) =>
    isMedicationSummary(document.metadata, document.sourceType),
  );
  const instructionSummaries = medicationSummaries.filter(
    (document) => document.sourceType === 'official_drug_instruction',
  );
  const otherSummaries = medicationSummaries.filter(
    (document) => document.sourceType !== 'official_drug_instruction',
  );

  const instructions = instructionIndexFromSummaries(instructionSummaries);
  const instructionSourceClasses = instructionSourceClassIndexFromSummaries(instructionSummaries);

  const registryProducts = new Map<string, MedicationProduct>();
  const allmedProducts = new Map<string, MedicationProduct>();
  const substances = new Map<string, AtcSubstance>();
  // The same packaging wording is repeated across registrations. Reuse immutable entries so
  // keeping the product list open does not retain a separate copy for every registration.
  const packaging = new Map<string, MedicationPackage>();
  const sharePackaging = (product: MedicationProduct): MedicationProduct => ({
    ...product,
    presentations: product.presentations.map((presentation) => ({
      ...presentation,
      packages: presentation.packages.map((item) => {
        const kept = packaging.get(item.description);
        if (kept?.prescriptionStatus === item.prescriptionStatus) return kept;
        if (!kept) packaging.set(item.description, item);
        return item;
      }),
    })),
  });
  let publishAt = 1;
  let lastPublishedAt = -Infinity;
  let processed = 0;
  await processMedicationSummariesInBatches(
    otherSummaries,
    (batchDocuments) => {
      const parsed = parseProducts(batchDocuments, instructions, instructionSourceClasses);
      addProducts(registryProducts, parsed.registry.map(sharePackaging));
      addProducts(allmedProducts, parsed.allmed.map(sharePackaging));
      for (const substance of parsed.substances) substances.set(substance.documentId, substance);
      processed += batchDocuments.length;
      if (processed >= publishAt && performance.now() - lastPublishedAt >= 250) {
        onUpdate(toProducts(registryProducts, allmedProducts), [...substances.values()]);
        publishAt = processed + 60;
        lastPublishedAt = performance.now();
      }
    },
    {
      signal,
      ...(getSummary
        ? {
            read: async (id) => {
              const result = await getSummary(id);
              if (!result.ok) throw new Error(result.error.message);
              return result.value;
            },
          }
        : {}),
    },
  );
  if (signal.aborted) return { products: [], substances: [] };
  return {
    products: toProducts(registryProducts, allmedProducts),
    substances: [...substances.values()],
  };
}

export function MedicationCatalogView(props: MedicationCatalogViewProps): JSX.Element {
  const [products, setProducts] = createSignal<readonly MedicationProduct[]>([]);
  const [searchQuery, setSearchQuery] = createSignal(consumeMedicationCatalogQuery());
  const [legacyRegistration, setLegacyRegistration] = createSignal(
    legacyMedicationRegistrationFromHash(window.location.hash),
  );
  const [substances, setSubstances] = createSignal<readonly AtcSubstance[]>([]);
  const [viewState, setViewState] = createSignal(
    medicationCatalogViewFromHash(window.location.hash),
  );
  const [loading, setLoading] = createSignal(true);
  const [catalogComplete, setCatalogComplete] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [headingElement, setHeadingElement] = createSignal<HTMLElement | undefined>();

  useStickySurface(headingElement);
  const mfgCountries = useMfgCountries(() => true);

  let pending: AbortController | undefined;
  const refresh = async (): Promise<void> => {
    pending?.abort();
    const request = new AbortController();
    pending = request;
    setLoading(true);
    setCatalogComplete(false);
    setError(undefined);
    setProducts([]);
    setSubstances([]);
    let firstBatchSeen = false;
    try {
      const complete = await loadProducts(props.core, request.signal, (next, nextSubstances) => {
        setProducts(next);
        setSubstances(nextSubstances);
        if (!firstBatchSeen) {
          firstBatchSeen = true;
          setLoading(false);
        }
      });
      if (!request.signal.aborted) {
        setProducts(complete.products);
        setSubstances(complete.substances);
      }
    } catch (cause) {
      if (!request.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Не удалось открыть базу препаратов.');
      }
    } finally {
      if (pending === request && !request.signal.aborted) {
        pending = undefined;
        setLoading(false);
        setCatalogComplete(true);
      }
    }
  };

  let active = isMedicationCatalogRoute(window.location.hash);
  let suspended:
    | WeakRef<readonly [readonly MedicationProduct[], readonly AtcSubstance[]]>
    | undefined;

  const syncCatalogRoute = (): void => {
    const visible = isMedicationCatalogRoute(window.location.hash);
    if (!visible) {
      if (active) {
        if (catalogComplete() && !error())
          suspended = new WeakRef([products(), substances()] as const);
        pending?.abort();
        pending = undefined;
        setProducts([]);
        setSubstances([]);
        setCatalogComplete(false);
      }
      active = false;
      return;
    }
    active = true;
    setLegacyRegistration(legacyMedicationRegistrationFromHash(window.location.hash));
    setViewState(medicationCatalogViewFromHash(window.location.hash));
    const requested = consumeMedicationCatalogQuery();
    if (requested) setSearchQuery(requested);

    if (catalogComplete() || pending) return;
    const kept = suspended?.deref();
    suspended = undefined;
    if (kept) {
      setProducts(kept[0]);
      setSubstances(kept[1]);
      setLoading(false);
      setCatalogComplete(true);
    } else {
      void refresh();
    }
  };

  const refreshIfVisible = (): void => {
    suspended = undefined;
    if (active) void refresh();
  };

  onMount(() => {
    syncCatalogRoute();
    window.addEventListener('hashchange', syncCatalogRoute);
    window.addEventListener(CONTENT_CHANGED_EVENT, refreshIfVisible);
  });
  onCleanup(() => {
    pending?.abort();
    window.removeEventListener('hashchange', syncCatalogRoute);
    window.removeEventListener(CONTENT_CHANGED_EVENT, refreshIfVisible);
  });

  const legacyProduct = createMemo(() => {
    const registration = legacyRegistration();
    if (!registration) return undefined;
    return products().find((product) => product.registrationNumber === registration);
  });

  createEffect(() => {
    const product = legacyProduct();
    const registration = legacyRegistration();
    if (!registration || !product) return;
    window.history.replaceState(
      { view: 'modules', route: 'documents/medications' },
      '',
      MEDICATION_CATALOG_HASH,
    );
    setLegacyRegistration(null);
    openMedicationProduct(product);
  });

  const mode = (): CatalogViewMode => viewState().view;
  const atcCode = (): string | null => {
    const state = viewState();
    return state.view === 'atc' ? state.code : null;
  };
  const switchMode = (next: CatalogViewMode): void => {
    // The two views of the catalog are one page: switching replaces the entry, it adds no step.
    replaceRoute(next === 'atc' ? MEDICATION_ATC_HASH : MEDICATION_CATALOG_HASH);
  };

  const deferredSearchQuery = createDeferred(searchQuery, { timeoutMs: 120 });
  const [visibleProducts, setVisibleProducts] = createSignal<readonly MedicationProduct[]>([]);
  createEffect(() => {
    const query = deferredSearchQuery();
    const rows = products();
    if (mode() !== 'list' || rows.length === 0) {
      setVisibleProducts([]);
      return;
    }
    if (!query.trim()) {
      setVisibleProducts(rows);
      return;
    }
    const request = new AbortController();
    onCleanup(() => request.abort());
    void rankMedicationCatalogSliced(rows, query, request.signal).then((matches) => {
      if (!request.signal.aborted) setVisibleProducts(matches);
    });
  });

  // The core holds only pointers until a medication package is installed: an empty catalog that
  // has finished loading is «not downloaded yet», not «no drugs».
  const needsDownload = () =>
    catalogComplete() && !loading() && !error() && products().length === 0 && !legacyRegistration();
  const notifyContentChanged = async (): Promise<void> => {
    if (props.onContentChanged) await props.onContentChanged();
    else window.dispatchEvent(new Event(CONTENT_CHANGED_EVENT));
  };

  const openProduct = (product: MedicationProduct): void => {
    openMedicationProduct(product);
  };

  return (
    <section class="medication-page" aria-busy={!catalogComplete()}>
      <Page
        hero={PAGE_HEROES.medications}
        class="medication-page-header"
        navigation={
          <NavBack class="knowledge-back-button" aria-label="Назад" onClick={props.onBack} />
        }
        icon={<AppGlyph name="pill" class="page__icon-glyph" />}
        title={<Heading depth={1}>Препараты</Heading>}
        description="Справочник препаратов и инструкций."
        help={
          mode() === 'atc' ? (
            <p class="medication-page__help">
              Анатомо-терапевтическо-химическая классификация: 14 групп. Вещества берутся из
              скачанных пакетов, поэтому каждая группа скачивается отдельно.
            </p>
          ) : undefined
        }
        helpTitle="Группы АТХ"
      />
      <div class="medication-view-switch">
        <SegmentedControl<CatalogViewMode>
          label="Вид каталога препаратов"
          value={mode()}
          onChange={switchMode}
          options={[
            { value: 'list', label: 'Список' },
            { value: 'atc', label: 'По группам АТХ' },
          ]}
        />
      </div>
      <Show when={mode() === 'list'}>
        <div
          ref={setHeadingElement}
          class="knowledge-subroute-heading knowledge-subroute-heading--blurred medication-route-heading route-sticky-chrome route-sticky-chrome--transparent"
        >
          <SearchField
            class="route-search knowledge-subroute-heading__control"
            value={searchQuery()}
            onInput={setSearchQuery}
            onClear={() => setSearchQuery('')}
            label="Поиск по препаратам"
            hideLabel
            placeholder="Название, МНН или показание"
          />
        </div>
      </Show>

      <Show when={mode() === 'atc'}>
        <section class="medication-catalog-section">
          <MedicationAtcTree
            substances={substances()}
            loading={loading() || !catalogComplete()}
            code={atcCode()}
            onContentChanged={notifyContentChanged}
          />
        </section>
      </Show>

      <Show when={mode() === 'list'}>
        <section class="medication-catalog-section">
          <div class="module-collection-heading">
            <h2 class="module-collection-heading__title">Препараты</h2>
            <Show when={!needsDownload()}>
              <CountBadge value={products().length} />
            </Show>
          </div>
          <Show when={needsDownload()}>
            <MedicationDownloadState onContentChanged={notifyContentChanged} />
          </Show>
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
                const variants = product.presentations.reduce(
                  (count, presentation) => count + presentation.packages.length,
                  0,
                );
                const description = () => productDescription(product);
                const country = () =>
                  countryMarkText(
                    manufacturingCountries(mfgCountries(), product.registrationNumber),
                  );
                return (
                  <button
                    type="button"
                    class="medication-product-card paper-card"
                    onClick={() => openProduct(product)}
                  >
                    <AppGlyph name="arrow-up-right" class="medication-product-card__open-icon" />
                    <strong class="medication-product-card__title">
                      {displayDrugName(product.tradeName)}
                      <Show when={country()}>
                        {(text) => (
                          <>
                            {' '}
                            <span
                              class="medication-product-card__country"
                              title={manufacturingBasisTitle(
                                manufacturingBasis(mfgCountries(), product.registrationNumber),
                              )}
                            >
                              ({text()})
                            </span>
                          </>
                        )}
                      </Show>
                    </strong>
                    <p class="medication-product-card__inn">{displayDrugName(product.inn)}</p>
                    <div class="medication-product-card__summary">
                      <span class="medication-product-card__description">{description()}</span>
                    </div>
                    <p class="medication-product-card-meta">
                      {product.registrationStatus} · {variants}{' '}
                      {pluralRu(variants, 'вариант', 'варианта', 'вариантов')} упаковки
                    </p>
                  </button>
                );
              }}
            </LayoutVirtualizedGrid>
          </div>
        </section>
      </Show>

      <Show when={legacyRegistration() && catalogComplete() && !legacyProduct()}>
        <div class="medication-empty paper-card">Препарат не найден в локальной базе.</div>
      </Show>
    </section>
  );
}
