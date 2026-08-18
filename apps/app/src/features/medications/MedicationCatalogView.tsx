import type { MedicalCore, MedicalDocument } from '@localmed/contracts';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { CountBadge } from '@/components/CountBadge';
import { stripKnownHtmlMarkupInline } from '@/components/html-markup';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { NavBack } from '@/components/NavBack';
import { SearchField } from '@/components/SearchField';
import { useStickySurface } from '@/components/sticky-surface';
import { rankMedicationCatalog } from '@/features/medications/medication-catalog-search';
import {
  documentFromSummary,
  processMedicationSummariesInBatches,
} from '@/features/medications/medication-loading';
import {
  type MedicationProduct,
  medicationDocumentRegistration,
  parseAllmedMedicationProduct,
  parseMedicationProduct,
  readableMedicationDocumentId,
} from '@/features/medications/medication-record';
import {
  legacyMedicationRegistrationFromHash,
  MEDICATION_CATALOG_HASH,
} from '@/features/medications/medication-routing';
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
    const documentId = readableMedicationDocumentId(product);
    if (!documentId) return;
    window.history.replaceState(
      { view: 'modules', route: 'documents/medications' },
      '',
      MEDICATION_CATALOG_HASH,
    );
    setLegacyRegistration(null);
    openDocumentOverlay(documentId);
  });

  const visibleProducts = createMemo(() => rankMedicationCatalog(products(), searchQuery()));

  const openProduct = (product: MedicationProduct): void => {
    const documentId = readableMedicationDocumentId(product);
    if (documentId) openDocumentOverlay(documentId);
  };

  return (
    <section class="medication-page">
      <div
        ref={setHeadingElement}
        class="knowledge-subroute-heading knowledge-subroute-heading--blurred medication-route-heading route-sticky-chrome"
      >
        <NavBack
          class="knowledge-back-button knowledge-subroute-heading__control"
          aria-label="Назад"
          onClick={() => props.onBack()}
        />
        <SearchField
          class="route-search knowledge-subroute-heading__control"
          value={searchQuery()}
          onInput={setSearchQuery}
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

      <Show when={legacyRegistration() && catalogComplete() && !legacyProduct()}>
        <div class="medication-empty paper-card">Препарат не найден в локальной базе.</div>
      </Show>
    </section>
  );
}
