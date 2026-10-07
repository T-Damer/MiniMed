import type {
  ContentModuleDownloadTask,
  MedicalCore,
  MedicalDocument,
  MedicalDocumentSummary,
} from '@localmed/contracts';
import { fullDocumentCandidateIds } from '@localmed/core';
import { createEffect, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';
import {
  displayDocumentTitle,
  resolveReadableDocumentId,
} from '@/features/library/document-display';
import { shouldReloadOfficialDocument } from '@/features/library/document-page-load';
import {
  type DocumentNavigateOptions,
  documentReaderBackTarget,
} from '@/features/library/document-reader-back';
import {
  isPlaceholderDocumentTitle,
  knownDocumentTitle,
  OPENING_DOCUMENT_TITLE,
  rememberDocumentSummaries,
} from '@/features/library/document-title-hints';
import { OfficialDocumentReader } from '@/features/library/OfficialDocumentReader';
import { UserDocumentReader } from '@/features/library/UserDocumentReader';
import { migrateLegacyUserDocumentHash } from '@/features/library/user-library-routing';
import { allmedMatchesProduct } from '@/features/medications/allmed-matching';
import {
  type ClinicalMedicationLink,
  parseClinicalMedicationLinks,
} from '@/features/medications/clinical-medication-links';
import {
  instructionIndexFromSummaries,
  instructionSourceClassIndexFromSummaries,
  isEsklpSubstanceDocument,
} from '@/features/medications/drug-screen';
import {
  EMPTY_SUBSTANCE_FALLBACK,
  productWithInstructionFallback,
  sameInstructionSlot,
} from '@/features/medications/instruction-fallback';
import {
  type InstructionModuleOffer,
  instructionModuleOffer,
} from '@/features/medications/instruction-offer';
import {
  consumeMedicationProductContext,
  medicationProductFromHistory,
  rememberMedicationProduct,
} from '@/features/medications/medication-navigation';
import {
  type MedicationProduct,
  type MedicationReadingMode,
  medicationReadingChoices,
  mergeAllmedSupplementalText,
  parseEsklpMedicationProducts,
  parseTradeNameSupplement,
  type TradeNameSupplement,
} from '@/features/medications/medication-record';
import { loadSubstanceFallback } from '@/features/medications/substance-fallback';
import {
  type ClinicalEditionLink,
  clinicalEditionNotice,
} from '@/features/modules/clinical-editions';
import { isModuleReleased } from '@/features/modules/local-packaged-modules';
import { loadModuleCatalog } from '@/features/modules/module-catalog-state';
import { contentModuleTaskProgress } from '@/features/modules/module-display';
import {
  assertIdentityDocumentTarget,
  installModulePointer,
  type ModulePointerResolution,
  modulePointerTargetAnchor,
  parseModulePointerMetadata,
  resolveCatalogDocumentPointer,
  resolveModulePointer,
} from '@/features/modules/module-pointer-install';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
import { canonicalDocumentId, isSameDocumentIdentity } from '@/state/document-identity';
import {
  consumePreferSummaryDocumentId,
  openDocumentOverlay,
  replaceLocationHash,
} from '@/state/document-navigation';
import {
  buildOfficialDocumentHash,
  type DocumentReadRoute,
  migrateLegacyDocumentHash,
  migrateLegacyOverlaySearch,
  parseDocumentReadRoute,
} from '@/state/document-route';
import {
  appendDocumentCrumb,
  clearDocumentTrail,
  type DocumentTrail,
  loadDocumentTrail,
  rebuildTrailForPastedRoute,
  sliceTrailToCrumb,
  sliceTrailToOrigin,
  updateCurrentCrumbDocument,
  updateCurrentCrumbTitle,
} from '@/state/document-trail';
import { hasInAppPreviousEntry } from '@/state/history-entries';

interface DocumentPageHostProps {
  readonly getCore: () => MedicalCore | undefined;
  readonly reconnectContent?: () => Promise<void>;
}

function normalizedTradeName(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
}

function linkedAllmedSummaries(
  summaries: readonly MedicalDocumentSummary[],
  mnnDocumentId: string,
): readonly MedicalDocumentSummary[] {
  return summaries.filter((summary) => {
    const metadata = summary.metadata;
    return (
      summary.sourceType === 'allmed_reference' &&
      metadata?.['contentMode'] === 'allmed-snapshot' &&
      metadata['linkedMnnDocumentId'] === mnnDocumentId
    );
  });
}

async function loadTradeNameSupplements(
  core: MedicalCore,
  summaries: readonly MedicalDocumentSummary[],
  mnnDocumentId: string,
  tradeName?: string,
  product?: MedicationProduct,
): Promise<readonly TradeNameSupplement[]> {
  const candidates = linkedAllmedSummaries(summaries, mnnDocumentId).filter(
    (summary) =>
      !tradeName || normalizedTradeName(summary.title) === normalizedTradeName(tradeName),
  );
  const documents = await Promise.all(candidates.map((summary) => core.getDocument(summary.id)));
  const uniqueByTradeName = new Map<string, TradeNameSupplement>();
  for (const result of documents) {
    if (!result.ok) continue;
    const supplement = parseTradeNameSupplement(result.value);
    if (!supplement || supplement.product.linkedMnnDocumentId !== mnnDocumentId) continue;
    // Same substance and trade name are not enough: an entry for another dosage form stays out.
    if (product && !allmedMatchesProduct(product, supplement.product)) continue;
    const key = normalizedTradeName(supplement.product.tradeName);
    if (!uniqueByTradeName.has(key)) uniqueByTradeName.set(key, supplement);
  }
  return [...uniqueByTradeName.values()];
}

function userFacingOpenError(message: string): string {
  if (message.includes('Document not found')) {
    return 'Документ пока не подключён к поиску. Подождите завершения установки или нажмите «Повторить» в разделе скачивания.';
  }
  return message;
}

/**
 * The name of a document before its text has loaded: the one the app met in a catalog list, else the
 * title the module catalog gives its member (a pointer's target is listed under the target's id).
 */
function earlyDocumentTitle(documentId: string): string | undefined {
  const known = knownDocumentTitle(documentId);
  if (known) return known;
  const catalogId = canonicalDocumentId(documentId);
  const catalogs = peekContentModuleRuntime()?.getCatalog().modules ?? [];
  for (const module of catalogs) {
    const title = module.documents.find((item) => item.documentId === catalogId)?.title?.trim();
    if (title) return title;
  }
  return undefined;
}

export function DocumentPageHost(props: DocumentPageHostProps): JSX.Element {
  const [route, setRoute] = createSignal<DocumentReadRoute | null>(null);
  const [trail, setTrail] = createSignal<DocumentTrail | null>(null);
  const [document, setDocument] = createSignal<MedicalDocument | undefined>();
  const [pendingTitle, setPendingTitle] = createSignal<string | undefined>(OPENING_DOCUMENT_TITLE);
  const [initialAnchor, setInitialAnchor] = createSignal<string | null>(null);
  const [availableDocuments, setAvailableDocuments] = createSignal<
    readonly MedicalDocumentSummary[]
  >([]);
  const [supplementalPanels, setSupplementalPanels] = createSignal<readonly TradeNameSupplement[]>(
    [],
  );
  const [medicationProduct, setMedicationProduct] = createSignal<MedicationProduct>();
  const [medicationReadingMode, setMedicationReadingMode] =
    createSignal<MedicationReadingMode>('short');
  const [instructionDocument, setInstructionDocument] = createSignal<MedicalDocument>();
  const [instructionOffer, setInstructionOffer] = createSignal<InstructionModuleOffer | null>(null);
  const [instructionOfferPending, setInstructionOfferPending] = createSignal(false);
  const [instructionOfferProgress, setInstructionOfferProgress] = createSignal<number | null>(null);
  const [instructionOfferError, setInstructionOfferError] = createSignal<string | null>(null);
  const [clinicalMedicationLinks, setClinicalMedicationLinks] = createSignal<
    readonly ClinicalMedicationLink[]
  >([]);
  const [openError, setOpenError] = createSignal<string | null>(null);
  const [modulePointer, setModulePointer] = createSignal<ModulePointerResolution | null>(null);
  const [modulePointerPending, setModulePointerPending] = createSignal(false);
  const [modulePointerProgress, setModulePointerProgress] = createSignal<number | null>(null);
  const [modulePointerInstallError, setModulePointerInstallError] = createSignal<string | null>(
    null,
  );
  const [editionPending, setEditionPending] = createSignal(false);
  const [editionProgress, setEditionProgress] = createSignal<number | null>(null);
  const [editionError, setEditionError] = createSignal<string | null>(null);
  const editionNotice = () => {
    const shown = document();
    return shown ? clinicalEditionNotice(shown.id) : null;
  };
  let loadingDocumentId: string | null = null;
  let loadedOfficialRequestId: string | null = null;
  let officialLoadGeneration = 0;
  let requestedIdentityKey = '';
  onCleanup(() => {
    officialLoadGeneration += 1;
  });

  /**
   * The trail follows the address: the history is what moves the reader between documents, and a
   * system back, a forward or a swipe must leave the breadcrumbs where they would be had the user
   * come there by hand. A document the trail already lists cuts everything after it; one it does
   * not list (a forward step, a link that bypassed the opener) joins it.
   */
  const syncTrail = (parsed: DocumentReadRoute): DocumentTrail => {
    let current = loadDocumentTrail();
    if (!current) {
      current = rebuildTrailForPastedRoute(parsed);
    } else {
      const index = current.crumbs.findIndex(
        (crumb) =>
          crumb.kind === parsed.kind && isSameDocumentIdentity(crumb.id, parsed.documentId),
      );
      if (index >= 0) {
        if (index < current.crumbs.length - 1) current = sliceTrailToCrumb(current, index);
      } else {
        current = appendDocumentCrumb(current, {
          kind: parsed.kind,
          id: parsed.documentId,
          title:
            parsed.kind === 'user'
              ? 'Личный документ'
              : (knownDocumentTitle(parsed.documentId) ?? OPENING_DOCUMENT_TITLE),
          ...(parsed.kind === 'official' && parsed.section ? { section: parsed.section } : {}),
          ...(parsed.kind === 'official' && parsed.expectedIdentity
            ? { expectedIdentity: parsed.expectedIdentity }
            : {}),
          ...(parsed.kind === 'user' && parsed.pageIndex !== undefined
            ? { pageIndex: parsed.pageIndex }
            : {}),
        });
      }
    }
    setTrail(current);
    return current;
  };

  const navigateTrail = (href: string, options?: DocumentNavigateOptions): void => {
    const current = trail();
    // The place the reader's back control leads to is the entry below this one: go there by
    // stepping back, so a crumb tap behaves like «Назад» instead of stacking the page again.
    if (!options?.replace && current && href === documentReaderBackTarget(current)) {
      if (hasInAppPreviousEntry()) {
        window.history.back();
        return;
      }
    }
    if (current) {
      if (href === current.origin.hash) {
        setTrail(sliceTrailToOrigin(current));
      } else {
        const crumbIndex = current.crumbs.findIndex((crumb) => crumb.href === href);
        if (crumbIndex >= 0) {
          setTrail(sliceTrailToCrumb(current, crumbIndex));
        }
      }
    }
    if (options?.replace) {
      replaceLocationHash(href);
      return;
    }
    window.location.hash = href;
  };

  const listDocuments = async (core: MedicalCore): Promise<readonly MedicalDocumentSummary[]> => {
    const list = await (core.listNavigationDocuments?.() ?? core.listDocuments());
    if (!list.ok) throw new Error(list.error.message);
    rememberDocumentSummaries(list.value);
    return list.value;
  };

  /**
   * The product with its instruction resolved against what is installed now: its own text, else
   * another registration's text of the same МНН (ADR-0023), else none. A missing or malformed
   * fallback asset only means no fallback.
   */
  const resolveProductInstruction = async (
    product: MedicationProduct,
    source: MedicalDocument,
    listed: readonly MedicalDocumentSummary[],
  ): Promise<MedicationProduct> => {
    if (product.sourceKind !== 'esklp' || !isEsklpSubstanceDocument(source)) return product;
    const asset = await loadSubstanceFallback().catch((cause: unknown) => {
      console.error('Не удалось загрузить сопоставление инструкций по веществу.', cause);
      return EMPTY_SUBSTANCE_FALLBACK;
    });
    const index = instructionIndexFromSummaries(listed);
    const resolved = productWithInstructionFallback({
      product,
      cardProducts: parseEsklpMedicationProducts(
        source,
        index,
        instructionSourceClassIndexFromSummaries(listed),
      ),
      asset,
      instructionIndex: index,
    });
    return sameInstructionSlot(resolved, product) ? product : resolved;
  };

  const loadOfficial = async (parsed: DocumentReadRoute & { kind: 'official' }): Promise<void> => {
    const documentId = parsed.documentId;
    const expectedIdentity = parsed.expectedIdentity;
    const identityKey = JSON.stringify(expectedIdentity ?? null);
    const queuedMedicationProduct = consumeMedicationProductContext(documentId);
    // After a reload the catalog handoff is gone; the product saved with this history entry remains.
    const selectedMedicationProduct =
      queuedMedicationProduct ??
      medicationProductFromHistory(window.history.state, documentId) ??
      undefined;
    setMedicationProduct(selectedMedicationProduct);
    setMedicationReadingMode(
      selectedMedicationProduct
        ? medicationReadingChoices(selectedMedicationProduct, documentId).initialMode
        : 'short',
    );
    setInstructionDocument(undefined);
    setInitialAnchor(parsed.section ?? null);

    if (
      !shouldReloadOfficialDocument(
        loadedOfficialRequestId ?? document()?.id,
        documentId,
        loadingDocumentId,
      ) &&
      !queuedMedicationProduct &&
      requestedIdentityKey === identityKey
    ) {
      return;
    }

    loadingDocumentId = documentId;
    requestedIdentityKey = identityKey;
    const generation = ++officialLoadGeneration;
    const current = () => generation === officialLoadGeneration;
    loadedOfficialRequestId = null;
    setOpenError(null);
    setModulePointer(null);
    setModulePointerInstallError(null);
    setModulePointerPending(false);
    setModulePointerProgress(null);
    setEditionError(null);
    setSupplementalPanels([]);
    setClinicalMedicationLinks([]);
    setDocument(undefined);
    // The target is named at once from what the app already knows; only an unknown one waits.
    const earlyTitle = earlyDocumentTitle(documentId);
    setPendingTitle(earlyTitle ?? OPENING_DOCUMENT_TITLE);
    const openingTrail = trail();
    const openingCrumb = openingTrail?.crumbs.at(-1);
    if (
      earlyTitle &&
      openingTrail &&
      openingCrumb &&
      isPlaceholderDocumentTitle(openingCrumb.title)
    ) {
      setTrail(updateCurrentCrumbTitle(openingTrail, earlyTitle));
    }

    let core = props.getCore();
    if (!core) {
      loadingDocumentId = null;
      setOpenError('Локальный поиск ещё не готов.');
      return;
    }

    const preferSummaryId = consumePreferSummaryDocumentId();
    const preferSummary = !!expectedIdentity || preferSummaryId === documentId;

    try {
      // Read the selected document before queuing catalog SQL on the same worker/native owner.
      // Merely awaiting it first is insufficient when the catalog request was already dispatched.
      const requested = await core.getDocument(documentId);
      if (!current()) return;
      if (requested.ok) {
        assertIdentityDocumentTarget(requested.value, expectedIdentity);
        setDocument(requested.value);
        setPendingTitle(undefined);
      }
      if (requested.ok && globalThis.document.visibilityState === 'visible') {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (!current()) return;
      }
      let listed = await listDocuments(core);
      if (!current()) return;
      setAvailableDocuments(listed);
      const availableIds = new Set(listed.map((item) => item.id));
      const readableId = preferSummary
        ? documentId
        : resolveReadableDocumentId(documentId, availableIds);
      const pointerSummary = listed.find((item) => item.id === documentId);
      const pointerMetadata = requested.ok ? requested.value.metadata : pointerSummary?.metadata;
      const pointer = parseModulePointerMetadata(pointerMetadata);
      if (pointer && !expectedIdentity) {
        const runtime =
          peekContentModuleRuntime() ?? getContentModuleRuntime(await loadModuleCatalog());
        if (!current()) return;
        const resolution = resolveModulePointer(
          pointer,
          runtime.getCatalog(),
          runtime.listInstalled(),
        );
        setModulePointer(resolution);
        if (
          pointer.targetDocumentId !== documentId &&
          (availableIds.has(pointer.targetDocumentId) || resolution.state === 'installed')
        ) {
          const target = await core.getDocument(pointer.targetDocumentId);
          if (!current()) return;
          if (target.ok && target.value.sections.some((section) => section.chunks.length > 0)) {
            // The pointer only stands in for the target: the target takes its history entry.
            openDocumentOverlay(
              pointer.targetDocumentId,
              modulePointerTargetAnchor(
                pointerMetadata,
                initialAnchor(),
                requested.ok
                  ? {
                      pointer: requested.value,
                      target: target.value,
                    }
                  : undefined,
              ),
              {
                preferSummary: true,
                replace: true,
                title: displayDocumentTitle(target.value),
              },
            );
            return;
          }
          setModulePointerInstallError(
            'Набор установлен, но полный документ недоступен. Повторите подключение в разделе скачивания.',
          );
        }
      }
      const summary = listed.find((item) => item.id === readableId);
      if (summary) {
        setPendingTitle(displayDocumentTitle(summary));
        let currentTrail = trail();
        if (currentTrail) {
          currentTrail = updateCurrentCrumbTitle(currentTrail, displayDocumentTitle(summary));
          setTrail(currentTrail);
        }
      }

      let result = readableId === documentId ? requested : await core.getDocument(readableId);
      if (!result.ok && props.reconnectContent) {
        await props.reconnectContent();
        if (!current()) return;
        const refreshedCore = props.getCore();
        if (!refreshedCore) {
          setOpenError('Локальный поиск ещё не готов.');
          return;
        }
        core = refreshedCore;
        const refreshedId = preferSummary
          ? documentId
          : resolveReadableDocumentId(documentId, availableIds);
        result = await refreshedCore.getDocument(refreshedId);
      }
      if (!current()) return;
      if (!result.ok) {
        if (result.error.code !== 'CONTENT_NOT_FOUND') {
          setOpenError(userFacingOpenError(result.error.message));
          return;
        }
        const runtime =
          peekContentModuleRuntime() ?? getContentModuleRuntime(await loadModuleCatalog());
        if (!current()) return;
        const resolution = resolveCatalogDocumentPointer(
          documentId,
          runtime.getCatalog(),
          runtime.listInstalled(),
          expectedIdentity,
        );
        if (resolution) {
          setModulePointer(resolution);
          const member = runtime
            .getCatalog()
            .modules.flatMap((module) => module.documents)
            .find((member) => member.documentId === documentId);
          setPendingTitle(member?.title ?? 'Документ из дополнительного набора');
          if (resolution.state === 'installed') {
            setModulePointerInstallError(
              'Набор установлен, но полный документ недоступен. Повторите подключение в разделе скачивания.',
            );
          }
          return;
        }
        setOpenError(userFacingOpenError(result.error.message));
        return;
      }
      assertIdentityDocumentTarget(result.value, expectedIdentity);
      setDocument(result.value);
      loadedOfficialRequestId = documentId;
      setPendingTitle(undefined);
      if (result.value.metadata['contentMode'] === 'esklp-mnn') {
        // Medication supplements need complete source metadata, but only after first text is visible.
        const fullSummaries = await core.listDocuments();
        if (!fullSummaries.ok) throw new Error(fullSummaries.error.message);
        const refreshedSummaries = fullSummaries.value;
        if (!current()) return;
        listed = refreshedSummaries;
        setAvailableDocuments(listed);
        setClinicalMedicationLinks(
          selectedMedicationProduct?.mnnDocumentId
            ? parseClinicalMedicationLinks(listed, selectedMedicationProduct.mnnDocumentId)
            : [],
        );
        const supplements = await loadTradeNameSupplements(
          core,
          listed,
          result.value.id,
          selectedMedicationProduct?.tradeName,
          selectedMedicationProduct,
        );
        if (!current()) return;
        setSupplementalPanels(supplements);
        if (selectedMedicationProduct) {
          const resolved = await resolveProductInstruction(
            selectedMedicationProduct,
            result.value,
            listed,
          );
          if (!current()) return;
          const shown = medicationProduct();
          if (
            resolved !== selectedMedicationProduct &&
            shown?.registrationNumber === resolved.registrationNumber &&
            shown.tradeName === resolved.tradeName
          ) {
            setMedicationProduct(resolved);
            rememberMedicationProduct(result.value.id, resolved);
          }
        }
      }
      let currentTrail = trail();
      if (currentTrail) {
        currentTrail = updateCurrentCrumbTitle(currentTrail, displayDocumentTitle(result.value));
        setTrail(currentTrail);
      }
    } catch (cause) {
      if (!current()) return;
      setOpenError(cause instanceof Error ? cause.message : 'Не удалось открыть документ.');
    } finally {
      if (current()) {
        loadingDocumentId = null;
      }
    }
  };

  /** The product card swaps its body between the opened card and the official instruction. */
  const changeMedicationReadingMode = async (mode: MedicationReadingMode): Promise<void> => {
    const instructionId = medicationProduct()?.instructionDocumentId;
    if (mode === 'short' || !instructionId || instructionId === document()?.id) {
      setMedicationReadingMode(mode);
      return;
    }
    const core = props.getCore();
    if (!core) {
      toast.error('Локальный поиск ещё не готов.');
      return;
    }
    setMedicationReadingMode('instruction');
    if (instructionDocument()?.id === instructionId) return;
    setInstructionDocument(undefined);
    const result = await core.getDocument(instructionId);
    if (
      medicationReadingMode() !== 'instruction' ||
      medicationProduct()?.instructionDocumentId !== instructionId
    ) {
      return;
    }
    if (!result.ok) {
      setMedicationReadingMode('short');
      toast.error(`Инструкция не открылась. ${userFacingOpenError(result.error.message)}`);
      return;
    }
    setInstructionDocument(result.value);
  };
  let productSwitchGeneration = 0;
  /**
   * Another trade name of the same substance (or, with `undefined`, the substance card) opens in
   * place: the document is the same, so the address stays and only the card, the Allmed material and
   * the saved history entry change.
   */
  const selectMedicationProduct = async (next: MedicationProduct | undefined): Promise<void> => {
    const source = document();
    if (!source) return;
    const generation = ++productSwitchGeneration;
    setMedicationProduct(next);
    setMedicationReadingMode(
      next ? medicationReadingChoices(next, source.id).initialMode : 'short',
    );
    setInstructionDocument(undefined);
    setSupplementalPanels([]);
    rememberMedicationProduct(source.id, next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const core = props.getCore();
    if (!core || !isEsklpSubstanceDocument(source)) return;
    try {
      let shown = next;
      if (next) {
        const resolved = await resolveProductInstruction(next, source, availableDocuments());
        if (generation !== productSwitchGeneration || document()?.id !== source.id) return;
        if (resolved !== next) {
          shown = resolved;
          setMedicationProduct(resolved);
          rememberMedicationProduct(source.id, resolved);
        }
      }
      const supplements = await loadTradeNameSupplements(
        core,
        availableDocuments(),
        source.id,
        shown?.tradeName,
        shown,
      );
      if (generation !== productSwitchGeneration || document()?.id !== source.id) return;
      setSupplementalPanels(supplements);
      if (!shown) return;
      const merged = mergeAllmedSupplementalText(
        shown,
        supplements.map((supplement) => supplement.product),
      );
      if (merged === shown) return;
      setMedicationProduct(merged);
      rememberMedicationProduct(source.id, merged);
    } catch (cause) {
      if (generation !== productSwitchGeneration) return;
      toast.error(
        cause instanceof Error ? cause.message : 'Не удалось загрузить справочные материалы.',
      );
    }
  };
  let instructionOfferGeneration = 0;
  /** The group's instruction module is offered while a drug of the open card has no official text. */
  const refreshInstructionOffer = async (
    product: MedicationProduct | undefined,
    source: MedicalDocument | undefined,
  ): Promise<void> => {
    const generation = ++instructionOfferGeneration;
    const primaryModuleId = source?.metadata['primaryModuleId'];
    if (
      !product ||
      product.instructionDocumentId ||
      !source ||
      !isEsklpSubstanceDocument(source) ||
      typeof primaryModuleId !== 'string'
    ) {
      setInstructionOffer(null);
      return;
    }
    try {
      const runtime =
        peekContentModuleRuntime() ?? getContentModuleRuntime(await loadModuleCatalog());
      if (generation !== instructionOfferGeneration) return;
      setInstructionOffer(
        instructionModuleOffer({
          substanceModuleId: primaryModuleId,
          catalogModules: runtime.getCatalog().modules,
          installedModuleIds: new Set(runtime.listInstalled().map((module) => module.moduleId)),
          isReleased: isModuleReleased,
        }),
      );
    } catch (cause) {
      if (generation !== instructionOfferGeneration) return;
      console.warn('Набор инструкций не удалось проверить.', cause);
      setInstructionOffer(null);
    }
  };
  createEffect(() => {
    void refreshInstructionOffer(medicationProduct(), document());
  });

  /** Downloads the group's instruction module, reconnects the core and opens the new text. */
  const installInstructionModule = async (): Promise<void> => {
    const offer = instructionOffer();
    const product = medicationProduct();
    const source = document();
    if (!offer || !product || !source || instructionOfferPending()) return;
    setInstructionOfferPending(true);
    setInstructionOfferProgress(null);
    setInstructionOfferError(null);
    try {
      const runtime =
        peekContentModuleRuntime() ?? getContentModuleRuntime(await loadModuleCatalog());
      const module = runtime.getCatalog().modules.find((entry) => entry.id === offer.moduleId);
      if (!module) throw new Error('Набор инструкций не найден в каталоге.');
      const task = runtime.install(module);
      setInstructionOfferProgress(contentModuleTaskProgress(task));
      const unsubscribe = runtime.subscribe((nextTask) => {
        if (nextTask.id === task.id)
          setInstructionOfferProgress(contentModuleTaskProgress(nextTask));
      });
      let completed: Awaited<ReturnType<typeof runtime.wait>>;
      try {
        completed = await runtime.wait(task.id);
      } finally {
        unsubscribe();
      }
      if (completed.state !== 'completed') {
        throw new Error(completed.errorMessage ?? 'Не удалось скачать инструкции.');
      }
      if (!props.reconnectContent) {
        throw new Error('Инструкции загружены, но локальный поиск не удалось обновить.');
      }
      await props.reconnectContent();
      const core = props.getCore();
      if (!core) throw new Error('Локальный поиск ещё не готов.');
      const list = await core.listDocuments();
      if (!list.ok) throw new Error(list.error.message);
      setAvailableDocuments(list.value);
      let next = await resolveProductInstruction(product, source, list.value);
      if (!next.instructionDocumentId) {
        const own = instructionIndexFromSummaries(list.value).get(product.registrationNumber);
        if (own) next = { ...next, instructionDocumentId: own };
      }
      setInstructionOffer(null);
      if (!next.instructionDocumentId) {
        toast.info('В скачанном наборе нет официальной инструкции для этого препарата.');
        return;
      }
      setMedicationProduct(next);
      rememberMedicationProduct(source.id, next);
      await changeMedicationReadingMode('instruction');
    } catch (cause) {
      setInstructionOfferError(
        cause instanceof Error ? cause.message : 'Не удалось скачать инструкции.',
      );
    } finally {
      setInstructionOfferPending(false);
    }
  };
  const showsInstruction = (): boolean => {
    const instructionId = medicationProduct()?.instructionDocumentId;
    return (
      medicationReadingMode() === 'instruction' &&
      !!instructionId &&
      instructionId !== document()?.id
    );
  };
  const readerDocument = (): MedicalDocument | undefined =>
    showsInstruction() ? instructionDocument() : document();
  const readerPendingTitle = (): string | undefined =>
    showsInstruction() && !instructionDocument() ? 'Открываем инструкцию' : pendingTitle();

  const requestModulePointerInstall = async (): Promise<void> => {
    const resolution = modulePointer();
    if (resolution?.state !== 'available' || modulePointerPending()) return;
    const pointerDocument = document();
    const pointerDocumentId = route()?.documentId;
    const openingRoute = route();
    const expectedIdentity =
      openingRoute?.kind === 'official' ? openingRoute.expectedIdentity : undefined;
    const generation = officialLoadGeneration;
    const current = () =>
      generation === officialLoadGeneration && route()?.documentId === pointerDocumentId;
    const runtime =
      peekContentModuleRuntime() ?? getContentModuleRuntime(await loadModuleCatalog());
    if (!current()) return;
    setModulePointerPending(true);
    setModulePointerProgress(null);
    setModulePointerInstallError(null);
    try {
      await installModulePointer(runtime, resolution, (progress) => {
        if (current()) setModulePointerProgress(progress);
      });
      if (!props.reconnectContent) {
        throw new Error('Набор загружен, но локальный поиск не удалось обновить.');
      }
      await props.reconnectContent();
      const refreshedCore = props.getCore();
      if (!refreshedCore) throw new Error('Локальный поиск ещё не готов.');
      // Reading the target proves it is connected. The new core's document list starts cold
      // (~3 s for 20 000 documents) and is not needed to show the text, so it loads afterwards.
      const target = await refreshedCore.getDocument(resolution.pointer.targetDocumentId);
      if (!target.ok || !target.value.sections.some((section) => section.chunks.length > 0)) {
        throw new Error('Набор загружен, но полный документ не удалось прочитать.');
      }
      if (!current()) return;
      assertIdentityDocumentTarget(target.value, expectedIdentity);
      const targetAnchor = modulePointerTargetAnchor(
        pointerDocument?.metadata,
        initialAnchor(),
        pointerDocument ? { pointer: pointerDocument, target: target.value } : undefined,
      );
      if (pointerDocumentId === resolution.pointer.targetDocumentId) {
        setDocument(target.value);
        setPendingTitle(undefined);
        setModulePointer(null);
        loadedOfficialRequestId = target.value.id;
        const currentTrail = trail();
        if (currentTrail)
          setTrail(updateCurrentCrumbTitle(currentTrail, displayDocumentTitle(target.value)));
        void listDocuments(refreshedCore).then(
          (listed) => {
            if (current()) setAvailableDocuments(listed);
          },
          (cause: unknown) => {
            console.warn(
              `Document list did not refresh after an install: ${cause instanceof Error ? cause.name : 'unknown'}`,
            );
          },
        );
        return;
      }
      openDocumentOverlay(resolution.pointer.targetDocumentId, targetAnchor, {
        preferSummary: true,
        replace: true,
        title: displayDocumentTitle(target.value),
        ...(expectedIdentity ? { expectedIdentity } : {}),
      });
    } catch (cause) {
      if (current())
        setModulePointerInstallError(
          cause instanceof Error ? cause.message : 'Не удалось загрузить набор документа.',
        );
    } finally {
      if (current()) {
        setModulePointerPending(false);
        setModulePointerProgress(null);
      }
    }
  };

  /**
   * The other edition of a clinical recommendation opens in the reader; when its module is not
   * installed the same tap downloads it through the shared queue and opens it once connected.
   */
  const openClinicalEdition = async (target: ClinicalEditionLink): Promise<void> => {
    if (editionPending()) return;
    const openedFrom = route()?.documentId;
    const stillHere = () => route()?.documentId === openedFrom;
    setEditionPending(true);
    setEditionProgress(null);
    setEditionError(null);
    try {
      const runtime =
        peekContentModuleRuntime() ?? getContentModuleRuntime(await loadModuleCatalog());
      const resolution = resolveCatalogDocumentPointer(
        target.documentId,
        runtime.getCatalog(),
        runtime.listInstalled(),
      );
      if (!resolution) throw new Error('Эту редакцию не удалось найти в каталоге загрузок.');
      if (resolution.state === 'unavailable') throw new Error(resolution.message);
      if (resolution.state === 'available') {
        await installModulePointer(runtime, resolution, (progress) => {
          if (stillHere()) setEditionProgress(progress);
        });
        if (!props.reconnectContent) {
          throw new Error('Редакция загружена, но локальный поиск не удалось обновить.');
        }
        await props.reconnectContent();
      }
      if (!stillHere()) return;
      openDocumentOverlay(target.documentId, null, { preferSummary: true });
    } catch (cause) {
      if (stillHere()) {
        setEditionError(
          cause instanceof Error ? cause.message : 'Не удалось открыть другую редакцию.',
        );
      }
    } finally {
      setEditionPending(false);
      setEditionProgress(null);
    }
  };

  const requestFullText = async (
    summary: MedicalDocument,
    onProgress?: (fraction: number | null) => void,
  ): Promise<void> => {
    let core = props.getCore();
    if (!core) throw new Error('Локальный поиск ещё не готов.');
    let documents = await listDocuments(core);
    let fullDocumentId = resolveReadableDocumentId(
      summary.id,
      new Set(documents.map((item) => item.id)),
    );
    if (fullDocumentId === summary.id) {
      const runtime =
        peekContentModuleRuntime() ?? getContentModuleRuntime(await loadModuleCatalog());
      const candidateIds = new Set(fullDocumentCandidateIds(summary.id));
      const matchingModules = runtime
        .getCatalog()
        .modules.filter(
          (module) =>
            module.releaseState === 'published' &&
            module.documents.some((item) => candidateIds.has(item.documentId)),
        );
      const module =
        matchingModules.find((candidate) => candidate.tags.includes('individual-recommendation')) ??
        matchingModules[0];
      if (!module) {
        throw new Error('Полная версия этой рекомендации пока недоступна для загрузки.');
      }

      const installed = runtime
        .listInstalled()
        .some((item) => item.moduleId === module.id && item.version === module.version);
      if (!installed) {
        const task = runtime.install(module);
        onProgress?.(contentModuleTaskProgress(task));
        const unsubscribe = runtime.subscribe((nextTask) => {
          if (nextTask.moduleId !== module.id || nextTask.version !== module.version) return;
          onProgress?.(contentModuleTaskProgress(nextTask));
        });
        let completed: ContentModuleDownloadTask;
        try {
          completed = await runtime.wait(task.id);
        } finally {
          unsubscribe();
        }
        if (completed.state !== 'completed') {
          throw new Error(completed.errorMessage ?? 'Не удалось загрузить полную рекомендацию.');
        }
      }

      if (!props.reconnectContent) {
        throw new Error('Документ загружен, но локальный поиск не удалось обновить.');
      }
      await props.reconnectContent();
      core = props.getCore();
      if (!core) throw new Error('Локальный поиск ещё не готов.');
      documents = await listDocuments(core);
      fullDocumentId = resolveReadableDocumentId(
        summary.id,
        new Set(documents.map((item) => item.id)),
      );
    }

    if (fullDocumentId === summary.id) {
      throw new Error('Полная рекомендация загружена, но не подключилась к локальной базе.');
    }
    const result = await core.getDocument(fullDocumentId);
    if (!result.ok) throw new Error(userFacingOpenError(result.error.message));
    setAvailableDocuments(documents);
    setDocument(result.value);
    setSupplementalPanels([]);
    setClinicalMedicationLinks([]);
    setMedicationProduct(undefined);
    loadedOfficialRequestId = fullDocumentId;
    setInitialAnchor(null);

    let currentTrail = trail();
    if (currentTrail) {
      currentTrail = updateCurrentCrumbDocument(
        currentTrail,
        fullDocumentId,
        displayDocumentTitle(result.value),
      );
      setTrail(currentTrail);
    }
    const nextHash = buildOfficialDocumentHash(fullDocumentId);
    window.history.replaceState(window.history.state, '', nextHash);
    setRoute(parseDocumentReadRoute(nextHash));
  };

  const syncFromLocation = (): void => {
    migrateLegacyDocumentHash();
    migrateLegacyUserDocumentHash();
    migrateLegacyOverlaySearch();
    const parsed = parseDocumentReadRoute(window.location.hash);
    const shown = route();
    if (parsed && (shown?.kind !== parsed.kind || shown.documentId !== parsed.documentId)) {
      // Another document starts at its top: the page keeps the scroll of the one before it, which
      // the short page of a loading document clamps to a few pixels below its title row. A
      // position saved on the history entry is restored by the reader once its text is there.
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    setRoute(parsed);
    if (!parsed) {
      officialLoadGeneration += 1;
      requestedIdentityKey = '';
      loadingDocumentId = null;
      loadedOfficialRequestId = null;
      setDocument(undefined);
      setSupplementalPanels([]);
      setClinicalMedicationLinks([]);
      setMedicationProduct(undefined);
      setPendingTitle(undefined);
      setOpenError(null);
      setModulePointer(null);
      setModulePointerInstallError(null);
      setModulePointerPending(false);
      setModulePointerProgress(null);
      clearDocumentTrail();
      setTrail(null);
      return;
    }
    const currentTrail = syncTrail(parsed);
    if (parsed.kind === 'official') {
      void loadOfficial(parsed);
      return;
    }
    officialLoadGeneration += 1;
    requestedIdentityKey = '';
    setDocument(undefined);
    setSupplementalPanels([]);
    setClinicalMedicationLinks([]);
    setMedicationProduct(undefined);
    loadedOfficialRequestId = null;
    setPendingTitle(undefined);
    setOpenError(null);
    setModulePointer(null);
    setModulePointerInstallError(null);
    const userTitle =
      currentTrail.crumbs[currentTrail.crumbs.length - 1]?.title ?? 'Личный документ';
    if (currentTrail.crumbs.length > 0) {
      setTrail(updateCurrentCrumbTitle(currentTrail, userTitle));
    }
  };

  onMount(() => {
    syncFromLocation();
    const handleLocation = (): void => {
      syncFromLocation();
    };
    window.addEventListener('hashchange', handleLocation);
    window.addEventListener('popstate', handleLocation);
    onCleanup(() => {
      window.removeEventListener('hashchange', handleLocation);
      window.removeEventListener('popstate', handleLocation);
    });
  });

  // One reader per document: a different document is a new reader, with its own find, section and
  // reading-position state (and the history entry's saved place, read when the reader is made).
  // The accessors follow the route; a copy of the route taken once would never re-key the readers.
  const userDocumentId = (): string | null => {
    const current = route();
    return current?.kind === 'user' ? current.documentId : null;
  };
  const officialDocumentId = (): string | null => {
    const current = route();
    return current?.kind === 'official' ? current.documentId : null;
  };
  const userPageIndex = (): number | undefined => {
    const current = route();
    return current?.kind === 'user' ? current.pageIndex : undefined;
  };

  return (
    <Show when={route()}>
      <>
        <Show when={userDocumentId()} keyed>
          {(documentId) => (
            <UserDocumentReader
              documentId={documentId}
              {...(userPageIndex() !== undefined
                ? { initialPageIndex: userPageIndex() as number }
                : {})}
              {...(trail() ? { trail: trail() } : {})}
              onNavigate={navigateTrail}
              onTitle={(title) => {
                const currentTrail = trail();
                if (!currentTrail) return;
                setTrail(updateCurrentCrumbTitle(currentTrail, title));
              }}
            />
          )}
        </Show>
        <Show when={officialDocumentId()} keyed>
          <OfficialDocumentReader
            core={props.getCore()}
            document={readerDocument()}
            {...(readerPendingTitle() ? { pendingTitle: readerPendingTitle() as string } : {})}
            availableDocuments={availableDocuments()}
            {...(medicationProduct()
              ? {
                  medicationProduct: medicationProduct() as MedicationProduct,
                  medicationReadingMode: medicationReadingMode(),
                  onMedicationReadingModeChange: (mode: MedicationReadingMode) =>
                    void changeMedicationReadingMode(mode),
                }
              : {})}
            {...(document()
              ? { medicationOpenedDocumentId: (document() as MedicalDocument).id }
              : {})}
            instructionOffer={instructionOffer()}
            instructionOfferPending={instructionOfferPending()}
            instructionOfferProgress={instructionOfferProgress()}
            instructionOfferError={instructionOfferError()}
            onInstallInstructionModule={() => void installInstructionModule()}
            supplementalPanels={showsInstruction() ? [] : supplementalPanels()}
            drugSupplements={supplementalPanels()}
            {...(document() ? { medicationSource: document() as MedicalDocument } : {})}
            onSelectMedicationProduct={(product) => void selectMedicationProduct(product)}
            clinicalMedicationLinks={clinicalMedicationLinks()}
            initialAnchor={initialAnchor()}
            trail={trail()}
            openError={openError()}
            modulePointer={modulePointer()}
            modulePointerPending={modulePointerPending()}
            modulePointerProgress={modulePointerProgress()}
            modulePointerInstallError={modulePointerInstallError()}
            onNavigate={navigateTrail}
            onInstallModulePointer={requestModulePointerInstall}
            {...(props.reconnectContent ? { onContentChanged: props.reconnectContent } : {})}
            {...(editionNotice() ? { editionNotice: editionNotice() } : {})}
            editionPending={editionPending()}
            editionProgress={editionProgress()}
            editionError={editionError()}
            onOpenEdition={(target) => void openClinicalEdition(target)}
            onRequestFullText={requestFullText}
          />
        </Show>
      </>
    </Show>
  );
}
