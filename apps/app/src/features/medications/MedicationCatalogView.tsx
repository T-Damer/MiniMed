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
import { rankMedicationCatalog } from '@/features/medications/medication-catalog-search';
import { processMedicationSummariesInBatches } from '@/features/medications/medication-loading';
import {
  consumeMedicationCatalogQuery,
  openMedicationProduct,
} from '@/features/medications/medication-navigation';
import {
  composeMedicationProducts,
  type MedicationProduct,
  medicationDocumentRegistration,
  parseAllmedMedicationProduct,
  parseEsklpMedicationProducts,
  parseMedicationProduct,
} from '@/features/medications/medication-record';
import {
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

interface PackageVariant {
  readonly key: string;
  readonly dosageForm: string;
  readonly strength: string | null;
  readonly description: string;
  readonly prescriptionStatus: string | null;
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

function sortProducts(products: readonly MedicationProduct[]): readonly MedicationProduct[] {
  return [...products].toSorted((left, right) => {
    const leftForm = left.presentations[0]?.dosageForm ?? '';
    const rightForm = right.presentations[0]?.dosageForm ?? '';
    return (
      left.tradeName.localeCompare(right.tradeName, 'ru') ||
      left.registrationNumber.localeCompare(right.registrationNumber, 'ru') ||
      leftForm.localeCompare(rightForm, 'ru')
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
  onUpdate: (products: readonly MedicationProduct[], substances: readonly AtcSubstance[]) => void,
): Promise<{
  readonly products: readonly MedicationProduct[];
  readonly substances: readonly AtcSubstance[];
}> {
  const summaries = await core.listDocuments();
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
  await processMedicationSummariesInBatches(otherSummaries, (batchDocuments) => {
    const parsed = parseProducts(batchDocuments, instructions, instructionSourceClasses);
    addProducts(registryProducts, parsed.registry);
    addProducts(allmedProducts, parsed.allmed);
    for (const substance of parsed.substances) substances.set(substance.documentId, substance);
    onUpdate(toProducts(registryProducts, allmedProducts), [...substances.values()]);
  });
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

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setCatalogComplete(false);
    setError(undefined);
    setProducts([]);
    setSubstances([]);
    let firstBatchSeen = false;
    try {
      const complete = await loadProducts(props.core, (next, nextSubstances) => {
        setProducts(next);
        setSubstances(nextSubstances);
        if (!firstBatchSeen) {
          firstBatchSeen = true;
          setLoading(false);
        }
      });
      setProducts(complete.products);
      setSubstances(complete.substances);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть базу препаратов.');
    } finally {
      setLoading(false);
      setCatalogComplete(true);
    }
  };

  const syncLegacyRegistration = (): void => {
    setLegacyRegistration(legacyMedicationRegistrationFromHash(window.location.hash));
    setViewState(medicationCatalogViewFromHash(window.location.hash));
  };

  onMount(() => {
    void refresh();
    window.addEventListener('hashchange', syncLegacyRegistration);
    window.addEventListener(CONTENT_CHANGED_EVENT, refresh);
  });
  onCleanup(() => {
    window.removeEventListener('hashchange', syncLegacyRegistration);
    window.removeEventListener(CONTENT_CHANGED_EVENT, refresh);
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
    window.location.hash = next === 'atc' ? MEDICATION_ATC_HASH : MEDICATION_CATALOG_HASH;
  };

  const deferredSearchQuery = createDeferred(searchQuery, { timeoutMs: 120 });
  const visibleProducts = createMemo(() =>
    rankMedicationCatalog(products(), deferredSearchQuery()),
  );

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
    <section class="medication-page">
      <Page
        class="medication-page-header"
        navigation={
          <NavBack
            class="knowledge-back-button"
            aria-label="К базе знаний"
            onClick={props.onBack}
          />
        }
        icon={<AppGlyph name="pill" class="page__icon-glyph" />}
        title={<Heading depth={1}>Препараты</Heading>}
        description="Справочник препаратов и инструкций."
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
                const variants = () => productVariants(product);
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
                      {product.registrationStatus} · {variants().length}{' '}
                      {pluralRu(variants().length, 'вариант', 'варианта', 'вариантов')} упаковки
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
