import type { MedicalCore, MedicalDocument } from '@localmed/contracts';
import {
  createDeferred,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppGlyph } from '@/components/AppGlyph';
import { CountBadge } from '@/components/CountBadge';
import { stripKnownHtmlMarkupInline } from '@/components/html-markup';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import { useStickySurface } from '@/components/sticky-surface';
import { Heading } from '@/components/Text';
import { rankMedicationCatalog } from '@/features/medications/medication-catalog-search';
import {
  documentFromSummary,
  processMedicationSummariesInBatches,
} from '@/features/medications/medication-loading';
import { openMedicationProduct } from '@/features/medications/medication-navigation';
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
  MEDICATION_CATALOG_HASH,
} from '@/features/medications/medication-routing';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';

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
}

function parseProducts(
  documents: readonly MedicalDocument[],
  instructions: ReadonlyMap<string, string>,
): ParsedMedicationProducts {
  const registry: MedicationProduct[] = [];
  const allmed: MedicationProduct[] = [];
  for (const document of documents) {
    if (metadataContentMode(document.metadata) === 'esklp-mnn') {
      registry.push(...parseEsklpMedicationProducts(document, instructions));
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
  return { registry, allmed };
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
      [presentation?.dosageForm, presentation?.strength].filter(Boolean).join(' '),
  );
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
    isMedicationSummary(document.metadata, document.sourceType),
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

  const registryProducts = new Map<string, MedicationProduct>();
  const allmedProducts = new Map<string, MedicationProduct>();
  await processMedicationSummariesInBatches(otherSummaries, (batchDocuments) => {
    const parsed = parseProducts(batchDocuments, instructions);
    addProducts(registryProducts, parsed.registry);
    addProducts(allmedProducts, parsed.allmed);
    onUpdate(toProducts(registryProducts, allmedProducts));
  });
  return toProducts(registryProducts, allmedProducts);
}

export function MedicationCatalogView(props: MedicationCatalogViewProps): JSX.Element {
  const [products, setProducts] = createSignal<readonly MedicationProduct[]>([]);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [legacyRegistration, setLegacyRegistration] = createSignal(
    legacyMedicationRegistrationFromHash(window.location.hash),
  );
  const [loading, setLoading] = createSignal(true);
  const [catalogComplete, setCatalogComplete] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [headingElement, setHeadingElement] = createSignal<HTMLElement | undefined>();

  useStickySurface(headingElement);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setCatalogComplete(false);
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
      setCatalogComplete(true);
    }
  };

  const syncLegacyRegistration = (): void => {
    setLegacyRegistration(legacyMedicationRegistrationFromHash(window.location.hash));
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

  const deferredSearchQuery = createDeferred(searchQuery, { timeoutMs: 120 });
  const visibleProducts = createMemo(() =>
    rankMedicationCatalog(products(), deferredSearchQuery()),
  );

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
        breadcrumbs={
          <AppBreadcrumbs
            items={[{ label: 'База знаний', href: '#/modules/documents' }, { label: 'Препараты' }]}
            onNavigate={(href) => {
              window.location.hash = href;
            }}
          />
        }
        icon={<AppGlyph name="pill" class="page__icon-glyph" />}
        title={<Heading depth={1}>Препараты</Heading>}
        description="Локальный справочник препаратов и официальных инструкций, доступный без сети."
      />
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

      <section class="medication-catalog-section">
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
              const description = () => productDescription(product);
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

      <Show when={legacyRegistration() && catalogComplete() && !legacyProduct()}>
        <div class="medication-empty paper-card">Препарат не найден в локальной базе.</div>
      </Show>
    </section>
  );
}
