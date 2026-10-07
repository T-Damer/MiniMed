import type {
  MedicalCore,
  MedicalDocument,
  MedicalDocumentSummary,
  MedicalSection,
  TextRange,
} from '@localmed/contracts';
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
import { toast } from 'solid-sonner';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { Disclosure } from '@/components/Disclosure';
import { DocumentCrumbs } from '@/components/DocumentCrumbs';
import { DocumentText, documentTextSearchText } from '@/components/DocumentText';
import { QueryHighlightedText } from '@/components/HighlightedText';
import { SegmentedControl } from '@/components/SegmentedControl';
import {
  createReaderBookmark,
  ReaderActionsMenu,
  ReaderTitleRow,
} from '@/features/collections/ReaderItemActions';
import { Icd10ToIcd11Panel } from '@/features/icd11/Icd10ToIcd11Panel';
import { Icd11CardPanel } from '@/features/icd11/Icd11CardPanel';
import { isIcd11Document } from '@/features/icd11/icd11-document';
import { ClinicalEditionNoticeLine } from '@/features/library/ClinicalEditionNotice';
import { DocumentFindBar, type DocumentFindResultState } from '@/features/library/DocumentFindBar';
import { DocumentModulePointer } from '@/features/library/DocumentModulePointer';
import {
  displayDocumentSubtitle,
  displayDocumentTitle,
  documentSectionHeadingTag,
  isAdministrativeSection,
  type MutableDocumentSectionTree,
  nestDocumentSections,
  resolveReadableDocumentId,
  sourceTypeReaderLabel,
  visibleReaderSections,
} from '@/features/library/document-display';
import { type DocumentFindUnit, rangesForFindUnit } from '@/features/library/document-find';
import { documentInteractiveToolLink } from '@/features/library/document-interactive-tool';
import {
  buildDocumentLinkPhrases,
  createDocumentLinkMatcher,
} from '@/features/library/document-medication-links';
import { printDocument, shareDocument, shareText } from '@/features/library/document-print';
import {
  DocumentReaderChromeShell,
  useDocumentReaderChrome,
} from '@/features/library/document-reader-chrome';
import { jumpReaderTo } from '@/features/library/document-reader-scroll';
import { DocumentRichBlock } from '@/features/library/document-rich-block';
import {
  documentRenderBlockSearchText,
  resolveDocumentChunkItems,
} from '@/features/library/document-rich-block-data';
import { RlsMedicationPackagingPanel } from '@/features/library/RlsMedicationPackagingPanel';
import type { ResolvedReferenceImage } from '@/features/library/reference-image-assets';
import { getReferenceImageResolver } from '@/features/library/reference-image-assets';
import { DrugSafetyBlock } from '@/features/medication-safety/DrugSafetyBlock';
import type { ClinicalMedicationLink } from '@/features/medications/clinical-medication-links';
import { DrugQuickLinks } from '@/features/medications/DrugQuickLinks';
import { DrugScreenHeader } from '@/features/medications/DrugScreenHeader';
import { DrugSectionIndex } from '@/features/medications/DrugSectionIndex';
import {
  buildDrugScreen,
  drugSectionIndex,
  drugShareText,
  instructionIndexFromSummaries,
  instructionSourceClassIndexFromSummaries,
  isEsklpSubstanceDocument,
} from '@/features/medications/drug-screen';
import {
  applyInstructionFallbacks,
  type FallbackNotice,
  fallbackNotice,
} from '@/features/medications/instruction-fallback';
import {
  INSTRUCTION_UNAVAILABLE_NOTICE,
  type InstructionModuleOffer,
  instructionOfferLabel,
} from '@/features/medications/instruction-offer';
import {
  type InstructionSourceInfo,
  instructionSourceInfo,
} from '@/features/medications/instruction-source';
import { openMedicationCatalogSearch } from '@/features/medications/medication-navigation';
import {
  ALLMED_SOURCE_URL,
  type ResolvedMedicationPackagingImage,
  resolveMedicationPackagingImage,
} from '@/features/medications/medication-packaging-images';
import {
  type MedicationProduct,
  type MedicationReadingMode,
  medicationReadingChoices,
  parseEsklpMedicationProducts,
  type TradeNameSupplement,
} from '@/features/medications/medication-record';
import { useMfgCountries } from '@/features/medications/use-mfg-countries';
import { useSubstanceFallback } from '@/features/medications/use-substance-fallback';
import type {
  ClinicalEditionLink,
  ClinicalEditionNotice,
} from '@/features/modules/clinical-editions';
import { formatFullTextDownloadLabel } from '@/features/modules/module-display';
import type { ModulePointerResolution } from '@/features/modules/module-pointer-install';
import { searchResultDocumentKind } from '@/features/search/ScopedMedicalCore';
import { buildDocumentSectionLink, openDocumentOverlay } from '@/state/document-navigation';
import type { DocumentTrail } from '@/state/document-trail';
import type { ItemRefInput } from '@/state/item-collections';

interface OfficialDocumentReaderProps {
  readonly core?: MedicalCore | undefined;
  readonly document: MedicalDocument | undefined;
  readonly pendingTitle?: string;
  readonly availableDocuments?: readonly MedicalDocumentSummary[];
  readonly medicationProduct?: MedicationProduct;
  /** The substance card (ЕСКЛП) the trade name belongs to; `document` is the instruction while it is open. */
  readonly medicationSource?: MedicalDocument;
  /** Picks another trade name of the same substance; `undefined` shows the substance card itself. */
  readonly onSelectMedicationProduct?: (product: MedicationProduct | undefined) => void;
  /** Allmed material for the header (packaging photo, Latin name); unlike the panels it is kept in the instruction view. */
  readonly drugSupplements?: readonly TradeNameSupplement[];
  /** The document the product card was opened on; the instruction may replace the body. */
  readonly medicationOpenedDocumentId?: string;
  readonly medicationReadingMode?: MedicationReadingMode;
  readonly onMedicationReadingModeChange?: (mode: MedicationReadingMode) => void;
  readonly supplementalPanels?: readonly TradeNameSupplement[];
  /** The group's instruction module, when it would add the official text of this drug. */
  readonly instructionOffer?: InstructionModuleOffer | null;
  readonly instructionOfferPending?: boolean;
  readonly instructionOfferProgress?: number | null;
  readonly instructionOfferError?: string | null;
  readonly onInstallInstructionModule?: () => void;
  readonly clinicalMedicationLinks?: readonly ClinicalMedicationLink[];
  readonly initialAnchor?: string | null;
  readonly trail: DocumentTrail | null;
  readonly openError?: string | null;
  readonly modulePointer?: ModulePointerResolution | null;
  readonly modulePointerPending?: boolean;
  readonly modulePointerProgress?: number | null;
  readonly modulePointerInstallError?: string | null;
  readonly onNavigate: (href: string) => void;
  readonly onInstallModulePointer?: () => Promise<void>;
  /** Reconnects the search core after a module is installed from inside the reader. */
  readonly onContentChanged?: () => Promise<void>;
  readonly editionNotice?: ClinicalEditionNotice | null;
  readonly editionPending?: boolean;
  readonly editionProgress?: number | null;
  readonly editionError?: string | null;
  readonly onOpenEdition?: (target: ClinicalEditionLink) => void;
  readonly onRequestFullText: (
    document: MedicalDocument,
    onProgress?: (fraction: number | null) => void,
  ) => Promise<void>;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').trim();
}

function statusLabel(status: string): string {
  if (status === 'active' || status === 'current') return 'Действующая редакция';
  if (status === 'superseded') return 'Заменённая редакция';
  if (status === 'historical') return 'Исторический документ';
  return status;
}

const emptyFindState: DocumentFindResultState = {
  query: '',
  mode: 'exact',
  matches: [],
  activeIndex: 0,
  loading: false,
};

const INITIAL_SECTION_BATCH = 4;
const SECTION_BATCH_SIZE = 3;

function sectionIndexForAnchor(
  sections: ReturnType<typeof visibleReaderSections>,
  anchor: string | null | undefined,
): number {
  if (!anchor) return -1;
  return sections.findIndex(
    (section) =>
      section.anchor === anchor || section.chunks.some((chunk) => chunk.anchor === anchor),
  );
}

function scheduleIdleWork(work: () => void): number {
  const requestIdleCallback = (
    globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(work, { timeout: 100 });
  }
  return window.setTimeout(work, 0);
}

function cancelIdleWork(handle: number): void {
  const cancelIdleCallback = (
    globalThis as typeof globalThis & { cancelIdleCallback?: (handle: number) => void }
  ).cancelIdleCallback;
  if (typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(handle);
    return;
  }
  window.clearTimeout(handle);
}

function AllmedSupplementPanel(props: {
  readonly supplement: TradeNameSupplement;
  readonly defaultOpen: boolean;
}): JSX.Element {
  const [image, setImage] = createSignal<ResolvedMedicationPackagingImage | null>(null);

  onMount(() => {
    const reference = props.supplement.product.imageReference;
    if (!reference) return;
    void resolveMedicationPackagingImage(reference).then(setImage);
  });

  return (
    <Disclosure
      class="document-allmed-supplement"
      title={props.supplement.product.tradeName}
      defaultOpen={props.defaultOpen}
    >
      <div class="document-allmed-supplement__body">
        <Show when={image()}>
          {(resolvedImage) => (
            <figure class="document-allmed-supplement__figure">
              <img
                class="document-allmed-supplement__image"
                src={resolvedImage().url}
                alt={`Фото упаковки: ${props.supplement.product.tradeName}`}
                loading="lazy"
              />
              <figcaption class="document-allmed-supplement__caption">
                Фото упаковки из справочного материала Allmed
              </figcaption>
            </figure>
          )}
        </Show>
        <Show when={props.supplement.product.shortDescription}>
          {(description) => <p class="document-allmed-supplement__description">{description()}</p>}
        </Show>
        <a
          class="document-allmed-supplement__source"
          href={ALLMED_SOURCE_URL}
          rel="noreferrer"
          target="_blank"
        >
          Источник: allmed.pro
        </a>
      </div>
    </Disclosure>
  );
}

function ReferencePointerImage(props: { readonly documentId: string }): JSX.Element {
  const [image, setImage] = createSignal<ResolvedReferenceImage | null>();
  const [failed, setFailed] = createSignal(false);

  onMount(() => {
    void getReferenceImageResolver()
      .resolveFirst(props.documentId)
      .then((value) => setImage(value))
      .catch(() => setFailed(true));
  });

  return (
    <Show
      when={image()}
      fallback={
        <Show when={failed()}>
          <p class="document-reference-image__fallback">Не удалось загрузить иллюстрацию.</p>
        </Show>
      }
    >
      {(value) => (
        <figure class="document-reference-image document-reference-image--pointer">
          <img
            class="document-reference-image__image"
            src={value().url}
            alt={value().alt}
            loading="lazy"
            onError={() => setFailed(true)}
            hidden={failed()}
          />
          <Show when={!failed()}>
            <figcaption class="document-reference-image__caption">
              <span>Источник: Красота и медицина</span>{' '}
              <a
                class="document-reference-image__source"
                href={value().sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Открыть
              </a>
            </figcaption>
          </Show>
          <Show when={failed()}>
            <p class="document-reference-image__fallback">
              Иллюстрация недоступна в подключённом наборе.
            </p>
          </Show>
        </figure>
      )}
    </Show>
  );
}

const OFFER_NOTE =
  'Официальной инструкции для этого препарата нет на устройстве: она может быть в наборе инструкций его группы.';

const ALLMED_FALLBACK_NOTICE =
  'Справочный материал Allmed; не является официальной инструкцией ГРЛС.';

/** The notice Allmed's own entry carries; one is enough for the section. */
function allmedNotice(supplements: readonly TradeNameSupplement[]): string {
  for (const supplement of supplements) {
    const notice = supplement.document.metadata['sourceNotice'];
    if (typeof notice === 'string' && notice.trim()) return notice.trim();
  }
  return ALLMED_FALLBACK_NOTICE;
}

function InstructionSourcePanel(props: { readonly info: InstructionSourceInfo }): JSX.Element {
  const sourceName = () =>
    props.info.sourceClass === 'manufacturer-site'
      ? `Сайт производителя${props.info.publisher ? `: ${props.info.publisher}` : ''}`
      : 'ГРЛС (Минздрав России)';
  return (
    <section
      class="document-instruction-source"
      classList={{
        'document-instruction-source--manufacturer': props.info.sourceClass === 'manufacturer-site',
      }}
      aria-label="Источник официального текста"
    >
      <p class="document-instruction-source__kind">{props.info.kindLabel}</p>
      <dl class="document-instruction-source__facts">
        <Show when={props.info.edition}>
          {(edition) => (
            <div class="document-instruction-source__fact">
              <dt class="document-instruction-source__term">Редакция</dt>
              <dd class="document-instruction-source__value">{edition()}</dd>
            </div>
          )}
        </Show>
        <div class="document-instruction-source__fact">
          <dt class="document-instruction-source__term">Источник</dt>
          <dd class="document-instruction-source__value">
            <Show when={props.info.sourceUrl} fallback={sourceName()}>
              {(url) => (
                <a
                  class="document-instruction-source__link"
                  href={url()}
                  rel="noreferrer"
                  target="_blank"
                >
                  {sourceName()}
                </a>
              )}
            </Show>
          </dd>
        </div>
        <Show when={props.info.fetchedOn}>
          {(date) => (
            <div class="document-instruction-source__fact">
              <dt class="document-instruction-source__term">Получено</dt>
              <dd class="document-instruction-source__value">{date()}</dd>
            </div>
          )}
        </Show>
      </dl>
      <Show when={props.info.matchNote}>
        {(note) => (
          <p class="document-instruction-source__match" role="note">
            {note()}
          </p>
        )}
      </Show>
      <Show when={props.info.qualityNote}>
        {(note) => (
          <p
            class="document-instruction-source__note"
            classList={{
              'document-instruction-source__note--low': props.info.quality === 'ocr-low',
            }}
            role="note"
          >
            {note()}
          </p>
        )}
      </Show>
    </section>
  );
}

/** What stands above another registration's text: label, warnings and the donor product. */
function InstructionFallbackPanel(props: { readonly notice: FallbackNotice }): JSX.Element {
  return (
    <section
      class="document-instruction-fallback"
      classList={{
        'document-instruction-fallback--warned': props.notice.warnings.length > 0,
      }}
      aria-label="Инструкция другого производителя"
    >
      <p class="document-instruction-fallback__label">{props.notice.label}</p>
      <Show when={props.notice.warnings.length > 0}>
        <ul class="document-instruction-fallback__warnings" role="note">
          <For each={props.notice.warnings}>
            {(warning) => <li class="document-instruction-fallback__warning">{warning}</li>}
          </For>
        </ul>
      </Show>
      <dl class="document-instruction-fallback__facts">
        <For each={props.notice.sourceFacts}>
          {(fact) => (
            <div class="document-instruction-fallback__fact">
              <dt class="document-instruction-fallback__term">{fact.term}</dt>
              <dd class="document-instruction-fallback__value">{fact.value}</dd>
            </div>
          )}
        </For>
      </dl>
      <p class="document-instruction-fallback__note">{props.notice.note}</p>
    </section>
  );
}

function MedicationProductPanel(props: {
  readonly product: MedicationProduct;
  readonly currentDocumentId: string;
  readonly openedDocumentId: string;
  readonly mode: MedicationReadingMode;
  readonly onModeChange: (mode: MedicationReadingMode) => void;
  /** The drug header already names the form and strength of a single presentation. */
  readonly formInHeader: boolean;
  /** The quick links already lead to the substance card. */
  readonly substanceLinked: boolean;
  readonly instructionOffer?: InstructionModuleOffer | null | undefined;
  readonly instructionOfferPending?: boolean | undefined;
  readonly instructionOfferProgress?: number | null | undefined;
  readonly instructionOfferError?: string | null | undefined;
  readonly onInstallInstructionModule?: (() => void) | undefined;
}): JSX.Element {
  const choices = () => medicationReadingChoices(props.product, props.openedDocumentId);
  const presentationList = () => (
    <For each={props.product.presentations}>
      {(presentation) => (
        <p class="document-medication-product__presentation">
          {presentation.dosageForm}
          <Show when={presentation.strength}> · {presentation.strength}</Show>
        </p>
      )}
    </For>
  );
  const sources = () => [
    ...(props.product.sourceKind === 'esklp' ? ['ЕСКЛП'] : []),
    ...(props.product.grlsRegistrationDocumentId ||
    (props.product.instructionDocumentId &&
      !props.product.instructionFallback &&
      props.product.instructionSourceClass !== 'manufacturer-site')
      ? ['ГРЛС']
      : []),
    ...(props.product.instructionSourceClass === 'manufacturer-site' &&
    !props.product.instructionFallback
      ? ['Сайт производителя']
      : []),
    ...(props.product.supplementalDescription || props.product.imageReference ? ['Allmed'] : []),
  ];
  const links = () =>
    [
      props.product.mnnDocumentId && !props.substanceLinked
        ? { id: props.product.mnnDocumentId, label: 'Карточка МНН' }
        : null,
      props.product.grlsRegistrationDocumentId
        ? { id: props.product.grlsRegistrationDocumentId, label: 'Регистрация ГРЛС' }
        : null,
    ].filter(
      (item): item is { readonly id: string; readonly label: string } =>
        // The opened card is the short version: the switch already leads back to it.
        item !== null && item.id !== props.currentDocumentId && item.id !== props.openedDocumentId,
    );

  return (
    <section class="document-medication-product" aria-label="Карточка препарата">
      <div class="document-medication-product__reading">
        <SegmentedControl
          label="Версия текста"
          class="document-medication-product__reading-switch"
          options={choices().options}
          value={props.mode}
          onChange={props.onModeChange}
        />
        <Show when={props.instructionOffer ? OFFER_NOTE : choices().note}>
          {(note) => <p class="document-medication-product__reading-note">{note()}</p>}
        </Show>
        <Show when={props.instructionOffer}>
          {(offer) => (
            <div class="document-medication-product__offer">
              <Button
                type="button"
                variant="secondary"
                class="document-medication-product__offer-button"
                disabled={props.instructionOfferPending ?? false}
                onClick={() => props.onInstallInstructionModule?.()}
              >
                {props.instructionOfferPending
                  ? props.instructionOfferProgress === null ||
                    props.instructionOfferProgress === undefined
                    ? 'Скачиваем инструкции…'
                    : `Скачиваем инструкции · ${Math.floor(props.instructionOfferProgress * 100)} %`
                  : instructionOfferLabel(offer())}
              </Button>
              <Show when={props.instructionOfferError}>
                {(message) => (
                  <p class="document-medication-product__offer-error" role="alert">
                    {message()}
                  </p>
                )}
              </Show>
            </div>
          )}
        </Show>
      </div>
      <Show
        when={props.product.presentations.length > 1}
        fallback={
          <Show when={!props.formInHeader}>
            <div class="document-medication-product__presentations">{presentationList()}</div>
          </Show>
        }
      >
        {/* Several packagings of one form read as noise above the text; they open on demand. */}
        <Disclosure
          variant="inline"
          class="document-medication-product__forms"
          title="Формы выпуска"
          meta={props.product.presentations.length}
        >
          <div class="document-medication-product__presentations">{presentationList()}</div>
        </Disclosure>
      </Show>
      <Show when={links().length > 0}>
        <div class="document-medication-product__links">
          <For each={links()}>
            {(link) => (
              <Button
                type="button"
                variant="secondary"
                class="document-medication-product__link"
                onClick={() => openDocumentOverlay(link.id, null, { preferSummary: true })}
              >
                {link.label}
              </Button>
            )}
          </For>
        </div>
      </Show>
      <Show when={sources().length > 0}>
        <p class="document-medication-product__source">Источник: {sources().join(' · ')}</p>
      </Show>
    </section>
  );
}

function ClinicalMedicationLinksPanel(props: {
  readonly links: readonly ClinicalMedicationLink[];
}): JSX.Element {
  return (
    <section
      class="document-clinical-medication-links"
      aria-labelledby="document-clinical-medication-links-title"
    >
      <h2
        id="document-clinical-medication-links-title"
        class="document-clinical-medication-links__title"
      >
        Клинические рекомендации
      </h2>
      <div class="document-clinical-medication-links__list">
        <For each={props.links}>
          {(link) => (
            <article class="document-clinical-medication-links__item">
              <Button
                type="button"
                variant="secondary"
                class="document-clinical-medication-links__link"
                onClick={() =>
                  openDocumentOverlay(link.pointerDocumentId, link.sourceAnchor, {
                    preferSummary: true,
                  })
                }
              >
                {link.recommendationTitle}
              </Button>
              <Show when={link.ageGroups.length > 0}>
                <p class="document-clinical-medication-links__population">
                  Популяция: {link.ageGroups.join(', ')}
                </p>
              </Show>
            </article>
          )}
        </For>
      </div>
      <p class="document-clinical-medication-links__source">Источник: клинические рекомендации</p>
    </section>
  );
}

export function OfficialDocumentReader(props: OfficialDocumentReaderProps): JSX.Element {
  /** A medication card saves the product (its stable card id), other pages save themselves. */
  const bookmarkItem = (document: MedicalDocument): ItemRefInput => {
    const product = props.medicationProduct;
    return product
      ? {
          kind: 'document',
          id: props.medicationOpenedDocumentId ?? document.id,
          title: product.tradeName,
          documentKind: 'medication',
        }
      : {
          kind: 'document',
          id: document.id,
          title: displayDocumentTitle(document),
          documentKind: searchResultDocumentKind(document),
        };
  };
  const [findState, setFindState] = createSignal<DocumentFindResultState>(emptyFindState);
  const [findOpen, setFindOpen] = createSignal(false);
  const [fullTextPending, setFullTextPending] = createSignal(false);
  const [fullTextProgress, setFullTextProgress] = createSignal<number | null>(null);
  const [fullTextError, setFullTextError] = createSignal<string | null>(null);
  const [mountedSectionCount, setMountedSectionCount] = createSignal(0);
  let flashTimeout: number | undefined;
  let flashedHeading: HTMLElement | null = null;

  const orderedSections = createMemo(() => {
    const document = props.document;
    if (!document) return [];
    return visibleReaderSections(document.sections, document.sourceType);
  });

  const visibleSections = createMemo(() => orderedSections().slice(0, mountedSectionCount()));
  // Stable node identities keep Solid's <For> from remounting already-rendered
  // sections on every idle batch append.
  const sectionTreeCache = new Map<MedicalSection, MutableDocumentSectionTree>();
  const visibleSectionTree = createMemo(() =>
    nestDocumentSections(visibleSections(), sectionTreeCache),
  );
  const sectionsPending = createMemo(
    () => mountedSectionCount() > 0 && mountedSectionCount() < orderedSections().length,
  );

  createEffect(() => {
    const sections = orderedSections();
    const document = props.document;
    if (!document || sections.length === 0) {
      setMountedSectionCount(0);
      return;
    }

    const anchorIndex = sectionIndexForAnchor(sections, props.initialAnchor);
    const initialCount =
      anchorIndex >= 0
        ? Math.min(sections.length, Math.max(INITIAL_SECTION_BATCH, anchorIndex + 1))
        : Math.min(INITIAL_SECTION_BATCH, sections.length);
    setMountedSectionCount(initialCount);

    if (initialCount >= sections.length) return;

    let cancelled = false;
    let count = initialCount;
    let idleHandle: number | undefined;

    const appendBatch = (): void => {
      if (cancelled) return;
      count = Math.min(
        sections.length,
        Math.max(count, mountedSectionCount()) + SECTION_BATCH_SIZE,
      );
      setMountedSectionCount(count);
      if (count < sections.length) {
        idleHandle = scheduleIdleWork(appendBatch);
      }
    };

    idleHandle = scheduleIdleWork(appendBatch);
    onCleanup(() => {
      cancelled = true;
      if (idleHandle !== undefined) cancelIdleWork(idleHandle);
    });
  });

  // Drug screen: header, quick links and section index. Only for a trade name or a substance card.
  const listedDocumentTitles = createMemo(
    () =>
      new Map(
        (props.availableDocuments ?? []).map((item) => [item.id, displayDocumentTitle(item)]),
      ),
  );
  const isDrugDocument = createMemo(() => {
    const source = props.medicationSource ?? props.document;
    return !!props.medicationProduct || (!!source && isEsklpSubstanceDocument(source));
  });
  const mfgCountries = useMfgCountries(isDrugDocument);
  const fallbackAsset = useSubstanceFallback(() => isDrugDocument());
  const drugSourceProducts = createMemo(() => {
    const source = props.medicationSource ?? props.document;
    if (!source || !isEsklpSubstanceDocument(source)) return [];
    const index = instructionIndexFromSummaries(props.availableDocuments ?? []);
    const products = parseEsklpMedicationProducts(
      source,
      index,
      instructionSourceClassIndexFromSummaries(props.availableDocuments ?? []),
    );
    const asset = fallbackAsset();
    return asset ? applyInstructionFallbacks(products, asset, index) : products;
  });
  const drugScreen = createMemo(() => {
    const document = props.document;
    if (!document) return null;
    return buildDrugScreen({
      mfgCountries: mfgCountries(),
      source: props.medicationSource ?? document,
      document,
      product: props.medicationProduct,
      sourceProducts: drugSourceProducts(),
      supplements: props.drugSupplements ?? props.supplementalPanels ?? [],
      documentTitle: (documentId) => listedDocumentTitles().get(documentId),
    });
  });
  const drugSections = createMemo(() => (drugScreen() ? drugSectionIndex(orderedSections()) : []));

  const findUnits = createMemo((): readonly DocumentFindUnit[] => {
    const document = props.document;
    if (!document) return [];
    const units: DocumentFindUnit[] = [];
    units.push({
      id: document.id,
      text: drugScreen()?.header.title ?? displayDocumentTitle(document),
    });
    for (const section of orderedSections()) {
      units.push({ id: section.anchor, text: section.title });
      for (const item of resolveDocumentChunkItems(section.chunks)) {
        units.push({
          id: item.chunk.anchor,
          text:
            item.kind === 'rich'
              ? documentRenderBlockSearchText(item.block)
              : documentTextSearchText(
                  item.chunk.originalText,
                  // biome-ignore lint/complexity/useLiteralKeys: source spans are optional runtime metadata.
                  item.chunk.metadata?.['sourceSpans'],
                ),
        });
      }
    }
    return units;
  });

  const findSearchable = createMemo(() => {
    const document = props.document;
    return Boolean(
      document &&
        (displayDocumentTitle(document).trim().length > 0 ||
          orderedSections().some(
            (section) => section.title.trim().length > 0 || section.chunks.length > 0,
          )),
    );
  });

  const findMatches = createMemo(() => findState().matches);
  const rangesByUnit = createMemo(() => {
    const map = new Map<string, TextRange[]>();
    for (const match of findMatches()) {
      const existing = map.get(match.unitId) ?? [];
      existing.push({ start: match.start, end: match.end });
      map.set(match.unitId, existing);
    }
    return map;
  });

  const activeMatch = createMemo(() => {
    const state = findState();
    return findMatches()[state.activeIndex];
  });
  let lastScrolledMatchKey = '';

  let cancelFindJump: (() => void) | undefined;
  const bookmark = createReaderBookmark();
  const chrome = useDocumentReaderChrome({
    ...(props.initialAnchor != null && props.initialAnchor !== ''
      ? { initialAnchor: props.initialAnchor }
      : {}),
    sectionSelector: '.document-overlay-section',
    outlineItemAttr: 'data-section-anchor',
    scrollSpyWhen: () => Boolean(props.document) && orderedSections().length > 0,
    onBeforeScrollTo: (anchor) => {
      const sectionIndex = sectionIndexForAnchor(orderedSections(), anchor);
      if (sectionIndex >= mountedSectionCount()) setMountedSectionCount(sectionIndex + 1);
    },
    onScrollTo: (_anchor, section) => {
      const heading = section?.querySelector<HTMLElement>('.document-overlay-section__title');
      if (heading) {
        if (flashTimeout !== undefined) {
          window.clearTimeout(flashTimeout);
          flashedHeading?.classList.remove('document-overlay-section__title--flash');
        }
        heading.classList.add('document-overlay-section__title--flash');
        flashedHeading = heading;
        flashTimeout = window.setTimeout(() => {
          heading.classList.remove('document-overlay-section__title--flash');
          if (flashedHeading === heading) flashedHeading = null;
          flashTimeout = undefined;
        }, 1200);
      }
    },
  });

  createEffect(() => {
    const match = activeMatch();
    const state = findState();
    if (!match || state.loading) {
      if (state.loading) lastScrolledMatchKey = '';
      return;
    }
    const key = `${match.unitId}:${String(match.start)}:${String(state.activeIndex)}`;
    if (key === lastScrolledMatchKey) return;
    lastScrolledMatchKey = key;
    const sectionIndex = sectionIndexForAnchor(orderedSections(), match.unitId);
    if (sectionIndex >= mountedSectionCount()) {
      setMountedSectionCount(sectionIndex + 1);
      lastScrolledMatchKey = '';
      return;
    }
    const unitId = match.unitId;
    const start = match.start;
    // The section is mounted. The jump measures the highlighted word every frame, so late layout
    // changes (sections far above that were only estimated, images) cannot leave it off screen.
    cancelFindJump?.();
    cancelFindJump = jumpReaderTo(
      () =>
        globalThis.document.querySelector<HTMLElement>(
          `[data-document-find-unit="${CSS.escape(unitId)}"][data-document-find-start="${String(start)}"]`,
        ) ?? globalThis.document.getElementById(unitId),
      { align: 'center' },
    );
  });

  onCleanup(() => cancelFindJump?.());
  let initialScrollKey: string | undefined;
  createEffect(() => {
    const document = props.document;
    const anchor = props.initialAnchor;
    if (!document) {
      initialScrollKey = undefined;
      return;
    }
    if (mountedSectionCount() === 0) return;
    const key = `${document.id}\n${anchor ?? ''}`;
    if (initialScrollKey === key) return;
    // The route mounts before its asynchronous document arrives. Scroll after the target renders,
    // once per document/anchor; later section batches must not reset the reader's position.
    const frame = requestAnimationFrame(() => {
      const target = anchor ? globalThis.document.getElementById(anchor) : null;
      if (anchor && !target) return;
      if (target) {
        target.scrollIntoView({ behavior: 'instant', block: 'start' });
        // The page below the anchor may not have mounted yet: the scroll then stops at the page
        // end with the anchor still below the fold. Try again as the next sections mount.
        if (target.getBoundingClientRect().top >= window.innerHeight) return;
      } else
        globalThis.document
          .querySelector<HTMLElement>('.document-overlay-paper')
          ?.scrollTo({ top: 0, behavior: 'instant' });
      initialScrollKey = key;
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  const availableIds = createMemo(
    () => new Set((props.availableDocuments ?? []).map((document) => document.id)),
  );
  const documentLinks = createMemo(() =>
    buildDocumentLinkPhrases(props.availableDocuments ?? [], props.document?.id),
  );
  const fullTextDocumentId = createMemo(() => {
    const document = props.document;
    if (document?.sourceType !== 'clinical_recommendation_summary') return null;
    const readableId = resolveReadableDocumentId(document.id, availableIds());
    return readableId === document.id ? null : readableId;
  });
  const documentLinkMatcher = createMemo(() =>
    props.document ? createDocumentLinkMatcher(documentLinks()) : null,
  );
  const isClinicalSummary = createMemo(
    () => props.document?.sourceType === 'clinical_recommendation_summary',
  );
  const interactiveTool = createMemo(() => {
    const document = props.document;
    return document ? documentInteractiveToolLink(document.metadata) : undefined;
  });
  const referenceImageResolver = createMemo(() => {
    const document = props.document;
    if (
      !document ||
      (document.sourceType !== 'krasotaimedicina_reference' &&
        document.metadata['sourceKind'] !== 'disease-reference')
    ) {
      return undefined;
    }
    const resolver = getReferenceImageResolver();
    return (documentId: string, source: string) => resolver.resolve(documentId, source);
  });

  const copySectionLink = async (documentId: string, sectionAnchor: string): Promise<void> => {
    const url = buildDocumentSectionLink(documentId, sectionAnchor);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Скопировано');
    } catch {
      toast.error('Не удалось скопировать ссылку на раздел.');
    }
  };

  const openFullText = async (): Promise<void> => {
    const document = props.document;
    if (!document || fullTextPending()) return;
    setFullTextPending(true);
    setFullTextProgress(null);
    setFullTextError(null);
    try {
      await props.onRequestFullText(document, setFullTextProgress);
    } catch (cause) {
      setFullTextError(
        cause instanceof Error ? cause.message : 'Не удалось загрузить полную рекомендацию.',
      );
    } finally {
      setFullTextPending(false);
      setFullTextProgress(null);
    }
  };
  const fullTextButtonLabel = (): string =>
    formatFullTextDownloadLabel(
      fullTextPending(),
      fullTextProgress(),
      Boolean(fullTextDocumentId()),
    );

  const shareDrug = (header: Parameters<typeof drugShareText>[0]): void => {
    shareText(header.title, drugShareText(header, window.location.href))
      .then((mode) => {
        toast.success(
          mode === 'shared' ? 'Карточка передана.' : 'Карточка скопирована в буфер обмена.',
        );
      })
      .catch((cause: unknown) => {
        // Closing the system share sheet rejects with AbortError; that is not a failure.
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        toast.error('Не удалось поделиться карточкой.');
      });
  };

  const pageTitle = (): string =>
    props.document
      ? displayDocumentTitle(props.document)
      : (props.pendingTitle ?? props.openError ?? 'Документ');

  return (
    <DocumentReaderChromeShell
      ariaLabel={pageTitle()}
      class="document-page document-overlay page-surface page-grain"
      chrome={chrome}
      searchOpen={findOpen}
      trail={props.trail}
      onNavigate={props.onNavigate}
      breadcrumbs={
        <Show when={props.trail}>
          {(currentTrail) => (
            <DocumentCrumbs
              trail={currentTrail()}
              onNavigate={props.onNavigate}
              pageTitle={props.document ? pageTitle() : null}
            />
          )}
        </Show>
      }
      headerSearchSlot={
        <Show when={props.document}>
          <DocumentFindBar
            units={findUnits}
            disabled={!findSearchable()}
            onOpenChange={setFindOpen}
            onResult={(next) => {
              setFindState((current) => {
                if (
                  !next.query.trim() &&
                  !current.query.trim() &&
                  !next.loading &&
                  !current.loading &&
                  next.matches.length === 0 &&
                  current.matches.length === 0
                ) {
                  return current;
                }
                return next;
              });
            }}
          />
        </Show>
      }
      printButton={
        <Show when={props.document}>
          {(documentValue) => (
            <div class="document-page__reader-actions">
              <ReaderActionsMenu
                bookmark={bookmark}
                actions={[
                  {
                    id: 'print',
                    label: 'Печать',
                    icon: 'printer',
                    onSelect: () => {
                      if (!printDocument(documentValue())) {
                        toast.error('Не удалось открыть окно печати.');
                      }
                    },
                  },
                ]}
              />
            </div>
          )}
        </Show>
      }
      bodyError={
        <Show when={props.openError}>
          {(message) => (
            <div class="document-page__error" role="alert">
              <p>{message()}</p>
            </div>
          )}
        </Show>
      }
      showLayout={Boolean(props.document) && !props.openError}
      outlineEnabled={!props.document || orderedSections().length > 1}
      loadingBody={
        <>
          <Show when={!props.document && !props.openError && props.modulePointer}>
            <article class="document-overlay-paper">
              <h1 class="document-overlay-paper__title">{pageTitle()}</h1>
              <DocumentModulePointer {...props} />
            </article>
          </Show>
          <Show when={!props.document && !props.openError && !props.modulePointer}>
            <div
              class="document-page__loading"
              role="status"
              aria-live="polite"
              aria-label="Загрузка страницы"
            >
              <span class="document-page__loading-spinner" aria-hidden="true" />
            </div>
          </Show>
        </>
      }
      outlineSearchSlot={
        <Show when={props.document}>
          <p class="document-overlay-outline-label">Оглавление</p>
        </Show>
      }
      outlineNav={
        <For each={orderedSections()}>
          {(section, index) => {
            const headingTag = documentSectionHeadingTag(section.depth);
            return (
              <button
                type="button"
                data-section-anchor={section.anchor}
                class={`document-overlay-outline-section-button document-overlay-outline-section-button--${headingTag}`}
                classList={{
                  'document-overlay-outline-section-button--active':
                    chrome.activeAnchor() === section.anchor,
                }}
                aria-current={chrome.activeAnchor() === section.anchor ? 'location' : undefined}
                onClick={() => chrome.scrollTo(section.anchor)}
              >
                <span class="document-overlay-outline-section-number">
                  {String(index() + 1).padStart(2, '0')}
                </span>
                <span class="document-overlay-outline-section-button__label">{section.title}</span>
              </button>
            );
          }}
        </For>
      }
      outlineFooter={
        <Show when={props.document}>
          {(documentValue) => (
            <Disclosure
              variant="inline"
              class="doctor-technical-details"
              title="Сведения об источнике"
            >
              <dl class="doctor-technical-details__list">
                <div class="doctor-technical-details__row">
                  <dt class="doctor-technical-details__term">Редакция</dt>
                  <dd class="doctor-technical-details__value">{documentValue().versionLabel}</dd>
                </div>
                <div class="doctor-technical-details__row">
                  <dt class="doctor-technical-details__term">Статус</dt>
                  <dd class="doctor-technical-details__value">
                    {statusLabel(documentValue().status)}
                  </dd>
                </div>
                <div class="doctor-technical-details__row">
                  <dt class="doctor-technical-details__term">Тип</dt>
                  <dd class="doctor-technical-details__value">
                    {documentValue().sourceType.replaceAll('_', ' ')}
                  </dd>
                </div>
              </dl>
            </Disclosure>
          )}
        </Show>
      }
      content={
        <article ref={chrome.setPaper} class="document-overlay-paper">
          <Show when={props.document}>
            {(documentValue) => (
              <>
                <Show
                  when={drugScreen()}
                  fallback={
                    <>
                      <Show when={sourceTypeReaderLabel(documentValue().sourceType)}>
                        {(label) => <p class="document-overlay-paper__source-label">{label()}</p>}
                      </Show>
                      <ReaderTitleRow item={bookmarkItem(documentValue())} bookmark={bookmark}>
                        <h1
                          class="document-overlay-paper__title"
                          classList={{
                            'document-overlay-paper__title--pointer': Boolean(props.modulePointer),
                          }}
                        >
                          <QueryHighlightedText
                            text={displayDocumentTitle(documentValue())}
                            query={findState().query}
                            exact={findState().mode === 'exact'}
                            fuzzy={findState().mode === 'similar'}
                            ranges={rangesForFindUnit(
                              rangesByUnit(),
                              documentValue().id,
                              findState().query,
                            )}
                            unitId={documentValue().id}
                            activeStart={
                              activeMatch()?.unitId === documentValue().id
                                ? activeMatch()?.start
                                : undefined
                            }
                            matchClass="document-overlay-match"
                          />
                        </h1>
                      </ReaderTitleRow>
                      <header class="document-overlay-paper__header">
                        <Show when={displayDocumentSubtitle(documentValue())}>
                          {(subtitle) => <p class="document-overlay-lead">{subtitle()}</p>}
                        </Show>
                        <Show when={!isIcd11Document(documentValue())}>
                          <Icd10ToIcd11Panel
                            document={documentValue()}
                            onContentChanged={props.onContentChanged}
                          />
                        </Show>
                        <Show when={props.editionNotice}>
                          {(notice) => (
                            <ClinicalEditionNoticeLine
                              notice={notice()}
                              pending={props.editionPending ?? false}
                              progress={props.editionProgress ?? null}
                              error={props.editionError ?? null}
                              onOpen={(target) => props.onOpenEdition?.(target)}
                            />
                          )}
                        </Show>
                        <Show when={fullTextError()}>
                          {(message) => (
                            <p class="document-overlay-full-text-error" role="alert">
                              {message()}
                            </p>
                          )}
                        </Show>
                        <Show when={isClinicalSummary() && !fullTextDocumentId()}>
                          <p class="document-overlay-summary-note">
                            Это краткая выжимка. Полная рекомендация загрузится и откроется здесь.
                          </p>
                        </Show>
                        <DocumentModulePointer {...props} />
                        <div class="document-overlay-paper__actions">
                          <Show when={interactiveTool()}>
                            {(tool) => (
                              <Button
                                type="button"
                                variant="primary"
                                class="document-overlay-action-button document-overlay-action-button--tool"
                                aria-label={`${tool().label}: ${displayDocumentTitle(documentValue())}`}
                                onClick={() => props.onNavigate(tool().href)}
                                icon={
                                  <AppGlyph
                                    name={
                                      tool().kind === 'assessment' ? 'list-checks' : 'calculator'
                                    }
                                    class="document-overlay-action-button__icon"
                                  />
                                }
                              >
                                {tool().label}
                              </Button>
                            )}
                          </Show>
                          <Show when={isClinicalSummary()}>
                            <Button
                              type="button"
                              class="document-overlay-full-text-inline"
                              variant="primary"
                              disabled={fullTextPending()}
                              aria-label={fullTextButtonLabel()}
                              onClick={() => void openFullText()}
                              icon={
                                <AppGlyph
                                  name={fullTextPending() ? 'refresh' : 'download'}
                                  class={`document-overlay-action-button__icon${fullTextPending() ? ' document-overlay-action-button__icon--spin' : ''}`}
                                />
                              }
                            >
                              {fullTextButtonLabel()}
                            </Button>
                          </Show>
                          <Show when={documentValue().sourceType === 'medical_reference'}>
                            <Button
                              type="button"
                              class="document-overlay-action-button"
                              aria-label="Поделиться памяткой"
                              onClick={() => {
                                shareDocument(documentValue())
                                  .then((mode) => {
                                    toast.success(
                                      mode === 'shared'
                                        ? 'Памятка передана.'
                                        : 'Памятка скопирована в буфер обмена.',
                                    );
                                  })
                                  .catch(() => toast.error('Не удалось поделиться памяткой.'));
                              }}
                              icon={
                                <AppGlyph
                                  name="share"
                                  class="document-overlay-action-button__icon"
                                />
                              }
                            >
                              Поделиться
                            </Button>
                          </Show>
                        </div>
                      </header>
                    </>
                  }
                >
                  {(screen) => (
                    <>
                      <DrugScreenHeader
                        header={screen().header}
                        bookmarkItem={bookmarkItem(documentValue())}
                        bookmark={bookmark}
                        onShare={() => shareDrug(screen().header)}
                        title={
                          <QueryHighlightedText
                            text={screen().header.title}
                            query={findState().query}
                            exact={findState().mode === 'exact'}
                            fuzzy={findState().mode === 'similar'}
                            ranges={rangesForFindUnit(
                              rangesByUnit(),
                              documentValue().id,
                              findState().query,
                            )}
                            unitId={documentValue().id}
                            activeStart={
                              activeMatch()?.unitId === documentValue().id
                                ? activeMatch()?.start
                                : undefined
                            }
                            matchClass="document-overlay-match"
                          />
                        }
                      />
                      <DrugQuickLinks
                        links={screen().links}
                        onSelectProduct={(product) => props.onSelectMedicationProduct?.(product)}
                        onOpenSubstance={(link) => {
                          if (link.target.kind === 'substance-card') {
                            props.onSelectMedicationProduct?.(undefined);
                            return;
                          }
                          openDocumentOverlay(link.target.documentId, null, {
                            preferSummary: true,
                          });
                        }}
                        onOpenGroup={(group) => openMedicationCatalogSearch(group.query)}
                      />
                    </>
                  )}
                </Show>

                <RlsMedicationPackagingPanel document={documentValue()} />

                <Show when={documentValue().sourceType === 'official_drug_instruction'}>
                  <DrugSafetyBlock document={documentValue()} />
                </Show>

                <Show when={isIcd11Document(documentValue())}>
                  <Icd11CardPanel document={documentValue()} />
                </Show>

                <Show when={props.medicationProduct}>
                  {(product) => (
                    <MedicationProductPanel
                      product={product()}
                      currentDocumentId={documentValue().id}
                      openedDocumentId={props.medicationOpenedDocumentId ?? documentValue().id}
                      mode={props.medicationReadingMode ?? 'short'}
                      onModeChange={(mode) => props.onMedicationReadingModeChange?.(mode)}
                      formInHeader={drugScreen()?.header.formInMeta ?? false}
                      substanceLinked={drugScreen()?.links.substance != null}
                      instructionOffer={props.instructionOffer}
                      instructionOfferPending={props.instructionOfferPending}
                      instructionOfferProgress={props.instructionOfferProgress}
                      instructionOfferError={props.instructionOfferError}
                      onInstallInstructionModule={props.onInstallInstructionModule}
                    />
                  )}
                </Show>

                <Show when={(props.supplementalPanels?.length ?? 0) > 0}>
                  <section
                    class="document-allmed-supplements"
                    aria-labelledby="document-allmed-supplements-title"
                  >
                    <h2
                      id="document-allmed-supplements-title"
                      class="document-allmed-supplements__title"
                    >
                      Справочные материалы Allmed
                    </h2>
                    <Show
                      when={
                        props.medicationProduct && !props.medicationProduct.instructionDocumentId
                      }
                    >
                      <p class="document-allmed-supplements__plaque" role="note">
                        {INSTRUCTION_UNAVAILABLE_NOTICE}
                      </p>
                    </Show>
                    <p class="document-allmed-supplements__notice">
                      {allmedNotice(props.supplementalPanels ?? [])}
                    </p>
                    <div class="document-allmed-supplements__list">
                      <For each={props.supplementalPanels ?? []}>
                        {(supplement, index) => (
                          <AllmedSupplementPanel
                            supplement={supplement}
                            defaultOpen={index() === 0}
                          />
                        )}
                      </For>
                    </div>
                  </section>
                </Show>

                <Show when={(props.clinicalMedicationLinks?.length ?? 0) > 0}>
                  <ClinicalMedicationLinksPanel links={props.clinicalMedicationLinks ?? []} />
                </Show>

                <Show
                  when={
                    documentValue().sourceType === 'core_catalog_pointer' &&
                    documentValue().metadata['sourceKind'] === 'disease-reference'
                  }
                >
                  <ReferencePointerImage
                    documentId={
                      typeof documentValue().metadata['sourceDocumentId'] === 'string'
                        ? (documentValue().metadata['sourceDocumentId'] as string)
                        : documentValue().id
                    }
                  />
                </Show>

                <Show
                  when={
                    props.medicationProduct?.instructionFallback &&
                    props.medicationProduct.instructionDocumentId === documentValue().id
                      ? props.medicationProduct.instructionFallback
                      : null
                  }
                >
                  {(source) => <InstructionFallbackPanel notice={fallbackNotice(source())} />}
                </Show>

                <Show
                  when={instructionSourceInfo(
                    documentValue(),
                    props.medicationProduct?.instructionFallback?.registrationNumber ??
                      props.medicationProduct?.registrationNumber,
                  )}
                >
                  {(info) => <InstructionSourcePanel info={info()} />}
                </Show>

                <Show when={drugSections().length > 0}>
                  <DrugSectionIndex
                    items={drugSections()}
                    activeAnchor={chrome.activeAnchor()}
                    onSelect={(anchor) => chrome.scrollTo(anchor)}
                  />
                </Show>

                <For each={visibleSectionTree()}>
                  {(node) => {
                    const renderSection = (treeNode: typeof node): JSX.Element => {
                      const section = treeNode.section;
                      const path = () => section.sectionPath.join(' / ');
                      const state = () => findState();
                      const currentMatch = () => activeMatch();
                      const headingTag = documentSectionHeadingTag(section.depth);
                      return (
                        <section
                          class="document-overlay-section"
                          classList={{
                            'document-overlay-section--active':
                              chrome.activeAnchor() === section.anchor,
                            'document-overlay-section--administrative': isAdministrativeSection(
                              section,
                              documentValue().sourceType,
                            ),
                          }}
                          id={section.anchor}
                        >
                          <Show when={normalize(path()) !== normalize(section.title)}>
                            <p class="document-overlay-path">{path()}</p>
                          </Show>
                          <Dynamic
                            component={headingTag}
                            class={`document-overlay-section__title document-overlay-section__title--${headingTag} document-overlay-section__title--copy`}
                            classList={{
                              'document-overlay-section__title--active':
                                chrome.activeAnchor() === section.anchor,
                            }}
                            tabIndex={0}
                            role="button"
                            aria-label={`Скопировать ссылку на раздел «${section.title}»`}
                            onClick={() => void copySectionLink(documentValue().id, section.anchor)}
                            onKeyDown={(event: KeyboardEvent) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                void copySectionLink(documentValue().id, section.anchor);
                              }
                            }}
                          >
                            <QueryHighlightedText
                              text={section.title}
                              query={state().query}
                              exact={state().mode === 'exact'}
                              fuzzy={state().mode === 'similar'}
                              ranges={rangesForFindUnit(
                                rangesByUnit(),
                                section.anchor,
                                state().query,
                              )}
                              unitId={section.anchor}
                              activeStart={
                                currentMatch()?.unitId === section.anchor
                                  ? currentMatch()?.start
                                  : undefined
                              }
                              matchClass="document-overlay-match"
                            />
                          </Dynamic>
                          <For each={resolveDocumentChunkItems(section.chunks)}>
                            {(item) => {
                              const activeStart = () =>
                                currentMatch()?.unitId === item.chunk.anchor
                                  ? currentMatch()?.start
                                  : undefined;
                              return (
                                <Show
                                  when={item.kind === 'rich' ? item.block : undefined}
                                  fallback={
                                    <div
                                      id={item.chunk.anchor}
                                      class="document-text-chunk"
                                      classList={{
                                        'document-initial-anchor':
                                          props.initialAnchor === item.chunk.anchor,
                                      }}
                                    >
                                      <DocumentText
                                        text={item.chunk.originalText}
                                        query={state().query}
                                        exactQuery={state().mode === 'exact'}
                                        fuzzyQuery={state().mode === 'similar'}
                                        ranges={rangesForFindUnit(
                                          rangesByUnit(),
                                          item.chunk.anchor,
                                          state().query,
                                        )}
                                        unitId={item.chunk.anchor}
                                        activeStart={activeStart()}
                                        highlightClass="document-overlay-match"
                                        paragraphClass="document-overlay-section__paragraph"
                                        // biome-ignore lint/complexity/useLiteralKeys: source spans are optional runtime metadata.
                                        sourceSpans={item.chunk.metadata?.['sourceSpans']}
                                        documentId={documentValue().id}
                                        resolveImage={referenceImageResolver()}
                                        core={props.core}
                                        documentLinkMatcher={documentLinkMatcher() ?? undefined}
                                        onDocumentLink={(documentId) => {
                                          openDocumentOverlay(documentId, null, {
                                            preferSummary: true,
                                          });
                                        }}
                                      />
                                    </div>
                                  }
                                >
                                  {(block) => (
                                    <div
                                      id={item.chunk.anchor}
                                      classList={{
                                        'document-rich-block': true,
                                        'document-initial-anchor':
                                          props.initialAnchor === item.chunk.anchor,
                                      }}
                                    >
                                      <DocumentRichBlock
                                        block={block()}
                                        highlight={{
                                          query: state().query,
                                          exact: state().mode === 'exact',
                                          fuzzy: state().mode === 'similar',
                                          ranges: rangesForFindUnit(
                                            rangesByUnit(),
                                            item.chunk.anchor,
                                            state().query,
                                          ),
                                          unitId: item.chunk.anchor,
                                          activeStart: activeStart(),
                                        }}
                                      />
                                    </div>
                                  )}
                                </Show>
                              );
                            }}
                          </For>
                          {/* The cached nodes keep their identity, but `children` is a plain array that the
                              tree rebuild replaces whenever a batch mounts: read the memo so this list
                              follows it (nested sections of a mounted root would never appear otherwise). */}
                          <For each={(visibleSectionTree(), treeNode.children)}>
                            {(child) => renderSection(child)}
                          </For>
                        </section>
                      );
                    };
                    return renderSection(node);
                  }}
                </For>
                <Show when={sectionsPending()}>
                  <div
                    class="document-overlay-paper__pending"
                    role="status"
                    aria-label="Загружаем остальные разделы"
                  >
                    <span class="document-overlay-spinner" aria-hidden="true" />
                  </div>
                </Show>
              </>
            )}
          </Show>
        </article>
      }
    />
  );
}
