import type { MedicalCore, MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';
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
import { WindowVirtualizer } from 'virtua/solid';

import { AppGlyph } from '@/components/AppGlyph';
import { stripKnownHtmlMarkupInline } from '@/components/html-markup';
import {
  type MedicationProduct,
  medicationDocumentRegistration,
  parseAllmedMedicationProduct,
  parseMedicationProduct,
} from '@/features/medications/medication-record';
import { ScopedMedicalCore } from '@/features/search/ScopedMedicalCore';
import { SearchWorkspace } from '@/features/search/SearchWorkspace';
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

// Fetching one document at a time (~4700 of them) serialized every round trip and blocked the
// first paint. Batching keeps the number of in-flight requests bounded while still resolving the
// whole catalog far faster than the original sequential loop.
const DOCUMENT_FETCH_BATCH_SIZE = 60;

async function fetchDocumentsInBatches(
  core: MedicalCore,
  summaries: readonly MedicalDocumentSummary[],
  onBatch?: (documents: readonly MedicalDocument[]) => void,
): Promise<readonly MedicalDocument[]> {
  const documents: MedicalDocument[] = [];
  for (let start = 0; start < summaries.length; start += DOCUMENT_FETCH_BATCH_SIZE) {
    const batch = summaries.slice(start, start + DOCUMENT_FETCH_BATCH_SIZE);
    const results = await Promise.all(batch.map((summary) => core.getDocument(summary.id)));
    const batchDocuments: MedicalDocument[] = [];
    for (const result of results) {
      if (!result.ok) throw new Error(result.error.message);
      batchDocuments.push(result.value);
    }
    documents.push(...batchDocuments);
    onBatch?.(batchDocuments);
  }
  return documents;
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
): Promise<void> {
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

  const instructionDocuments = await fetchDocumentsInBatches(core, instructionSummaries);
  const instructions = new Map(
    instructionDocuments.flatMap((document) => {
      const registration = medicationDocumentRegistration(document);
      return registration ? [[registration, document.id] as const] : [];
    }),
  );

  let accumulated: readonly MedicationProduct[] = [];
  await fetchDocumentsInBatches(core, otherSummaries, (batchDocuments) => {
    accumulated = accumulated.concat(toProducts(batchDocuments, instructions));
    onUpdate(
      [...accumulated].toSorted((left, right) =>
        left.tradeName.localeCompare(right.tradeName, 'ru'),
      ),
    );
  });
}

export function MedicationCatalogView(props: MedicationCatalogViewProps): JSX.Element {
  const [products, setProducts] = createSignal<readonly MedicationProduct[]>([]);
  const [selectedRegistration, setSelectedRegistration] = createSignal(
    selectedRegistrationFromLocation(),
  );
  const [selectedVariant, setSelectedVariant] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>();

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    setProducts([]);
    let firstBatchSeen = false;
    try {
      await loadProducts(props.core, (next) => {
        setProducts(next);
        if (!firstBatchSeen) {
          firstBatchSeen = true;
          setLoading(false);
        }
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть базу препаратов.');
    } finally {
      setLoading(false);
    }
  };
  const syncRoute = (): void => {
    setSelectedRegistration(selectedRegistrationFromLocation());
    setSelectedVariant(0);
  };

  onMount(() => {
    void refresh();
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener(CONTENT_CHANGED_EVENT, refresh);
  });
  onCleanup(() => {
    window.removeEventListener('hashchange', syncRoute);
    window.removeEventListener(CONTENT_CHANGED_EVENT, refresh);
  });

  const selectedProduct = createMemo(() =>
    products().find((product) => product.registrationNumber === selectedRegistration()),
  );
  const searchableDocumentIds = createMemo(
    () =>
      new Set(
        products().flatMap((product) => [
          product.registrationDocumentId,
          ...(product.instructionDocumentId ? [product.instructionDocumentId] : []),
        ]),
      ),
  );
  const medicationCore = createMemo(
    () => new ScopedMedicalCore(props.core, undefined, 'medications', searchableDocumentIds()),
  );

  createEffect(() => {
    selectedProduct();
    setSelectedVariant(0);
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
    <section class="medication-page">
      <div class="knowledge-subroute-heading medication-route-heading">
        <button type="button" class="knowledge-back-button" aria-label="Назад" onClick={back}>
          <AppGlyph name="arrow-left" />
        </button>
        <div>
          <p class="archive-kicker">Локальная база препаратов</p>
          <h1>{selectedProduct()?.tradeName ?? 'Лекарственные препараты'}</h1>
        </div>
      </div>

      <Show when={!selectedRegistration()}>
        <div class="search-workspace-main medication-search">
          <SearchWorkspace
            core={medicationCore()}
            scope="medications"
            compact
            searchAllowed={!loading() && products().length > 0}
            placeholder="Название, МНН, показание…"
            examples={[
              'Мирамистин',
              'Мирамистин показания',
              'Мирамистин способ применения у детей',
            ]}
          />
        </div>

        <section class="medication-catalog-section">
          <div class="module-collection-heading">
            <h2>Препараты</h2>
            <span>{products().length}</span>
          </div>
          <Show when={loading()}>
            <div class="medication-empty paper-card" role="status">
              Открываем локальную базу…
            </div>
          </Show>
          <Show when={error()}>{(message) => <div class="error-card">{message()}</div>}</Show>
          <div class="medication-grid">
            <WindowVirtualizer data={products()} bufferSize={400}>
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
                    <AppGlyph
                      name="arrow-square-up-right"
                      class="medication-product-card-open-icon"
                    />
                    <span class="medication-card-state">{product.registrationStatus}</span>
                    <strong>{product.tradeName}</strong>
                    <p>{product.inn}</p>
                    <div>
                      <span class="medication-card-description">{description()}</span>
                      <span>{variants().length} вариантов упаковки</span>
                    </div>
                  </button>
                );
              }}
            </WindowVirtualizer>
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
                  <span class="medication-card-state">{product().registrationStatus}</span>
                  <p class="medication-inn">{product().inn}</p>
                  <div class="medication-tags">
                    <For each={product().pharmacotherapeuticGroups}>
                      {(group) => <span>{group}</span>}
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

              <section class="medication-section">
                <h2>Другие формы и упаковки</h2>
                <div class="medication-variant-grid">
                  <For each={variants()}>
                    {(variant, index) => (
                      <button
                        type="button"
                        class="paper-card"
                        classList={{ active: selectedVariant() === index() }}
                        onClick={() => setSelectedVariant(index())}
                      >
                        <strong>{packageTitle(variant.description)}</strong>
                        <span>{variant.dosageForm}</span>
                        <small>{variant.description}</small>
                      </button>
                    )}
                  </For>
                </div>
              </section>

              <section class="medication-registry paper-card">
                <h2>Регистрационные данные</h2>
                <dl>
                  <div>
                    <dt>Регистрационное удостоверение</dt>
                    <dd>{product().registrationNumber}</dd>
                  </div>
                  <div>
                    <dt>Дата регистрации</dt>
                    <dd>{product().registrationDate ?? 'Не указана'}</dd>
                  </div>
                  <div>
                    <dt>Держатель</dt>
                    <dd>{product().holder ?? 'Не указан'}</dd>
                  </div>
                  <div>
                    <dt>Производитель</dt>
                    <dd>{product().manufacturer ?? 'Не указан'}</dd>
                  </div>
                </dl>
              </section>

              <section class="medication-section">
                <h2>Похожие</h2>
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
