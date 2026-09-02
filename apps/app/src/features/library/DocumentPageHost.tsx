import type {
  ContentModuleDownloadTask,
  MedicalCore,
  MedicalDocument,
  MedicalDocumentSummary,
} from '@localmed/contracts';
import { fullDocumentCandidateIds } from '@localmed/core';
import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import {
  displayDocumentTitle,
  resolveReadableDocumentId,
} from '@/features/library/document-display';
import { shouldReloadOfficialDocument } from '@/features/library/document-page-load';
import { OfficialDocumentReader } from '@/features/library/OfficialDocumentReader';
import { UserDocumentReader } from '@/features/library/UserDocumentReader';
import { migrateLegacyUserDocumentHash } from '@/features/library/user-library-routing';
import {
  type ClinicalMedicationLink,
  parseClinicalMedicationLinks,
} from '@/features/medications/clinical-medication-links';
import { consumeMedicationProductContext } from '@/features/medications/medication-navigation';
import {
  type MedicationProduct,
  parseTradeNameSupplement,
  type TradeNameSupplement,
} from '@/features/medications/medication-record';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import { contentModuleTaskProgress } from '@/features/modules/module-display';
import {
  installModulePointer,
  type ModulePointerResolution,
  parseModulePointerMetadata,
  resolveModulePointer,
} from '@/features/modules/module-pointer-install';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
import { consumePreferSummaryDocumentId, openDocumentOverlay } from '@/state/document-navigation';
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

export function DocumentPageHost(props: DocumentPageHostProps): JSX.Element {
  const [route, setRoute] = createSignal<DocumentReadRoute | null>(null);
  const [trail, setTrail] = createSignal<DocumentTrail | null>(null);
  const [document, setDocument] = createSignal<MedicalDocument | undefined>();
  const [pendingTitle, setPendingTitle] = createSignal<string | undefined>('Открываем документ');
  const [initialAnchor, setInitialAnchor] = createSignal<string | null>(null);
  const [availableDocuments, setAvailableDocuments] = createSignal<
    readonly MedicalDocumentSummary[]
  >([]);
  const [supplementalPanels, setSupplementalPanels] = createSignal<readonly TradeNameSupplement[]>(
    [],
  );
  const [medicationProduct, setMedicationProduct] = createSignal<MedicationProduct>();
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
  let loadingDocumentId: string | null = null;
  let loadedOfficialRequestId: string | null = null;

  const syncTrail = (parsed: DocumentReadRoute): DocumentTrail => {
    let current = loadDocumentTrail();
    if (!current) {
      current = rebuildTrailForPastedRoute(parsed);
    } else if (current.crumbs.length === 0) {
      current = appendDocumentCrumb(current, {
        kind: parsed.kind,
        id: parsed.documentId,
        title: parsed.kind === 'user' ? 'Личный документ' : 'Документ',
        ...(parsed.kind === 'official' && parsed.section ? { section: parsed.section } : {}),
        ...(parsed.kind === 'user' && parsed.pageIndex !== undefined
          ? { pageIndex: parsed.pageIndex }
          : {}),
      });
    }
    setTrail(current);
    return current;
  };

  const navigateTrail = (href: string): void => {
    const current = trail();
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
    window.location.hash = href;
  };

  const listDocuments = async (core: MedicalCore): Promise<readonly MedicalDocumentSummary[]> => {
    const list = await core.listDocuments();
    return list.ok ? list.value : [];
  };

  const loadOfficial = async (parsed: DocumentReadRoute & { kind: 'official' }): Promise<void> => {
    const documentId = parsed.documentId;
    const selectedMedicationProduct = consumeMedicationProductContext(documentId) ?? undefined;
    setMedicationProduct(selectedMedicationProduct);
    setInitialAnchor(parsed.section ?? null);

    if (
      !shouldReloadOfficialDocument(
        loadedOfficialRequestId ?? document()?.id,
        documentId,
        loadingDocumentId,
      ) &&
      !selectedMedicationProduct
    ) {
      return;
    }

    loadingDocumentId = documentId;
    loadedOfficialRequestId = null;
    setOpenError(null);
    setModulePointer(null);
    setModulePointerInstallError(null);
    setSupplementalPanels([]);
    setClinicalMedicationLinks([]);
    setDocument(undefined);
    setPendingTitle('Открываем документ');

    let core = props.getCore();
    if (!core) {
      loadingDocumentId = null;
      setOpenError('Локальный поиск ещё не готов.');
      return;
    }

    const preferSummaryId = consumePreferSummaryDocumentId();
    const preferSummary = preferSummaryId === documentId;

    try {
      let listed = await listDocuments(core);
      if (loadingDocumentId !== documentId) return;
      setAvailableDocuments(listed);
      const availableIds = new Set(listed.map((item) => item.id));
      const readableId = preferSummary
        ? documentId
        : resolveReadableDocumentId(documentId, availableIds);
      const pointerSummary = listed.find((item) => item.id === documentId);
      const pointerMetadata = pointerSummary?.metadata;
      const pointer = parseModulePointerMetadata(pointerMetadata);
      if (pointer) {
        const runtime = peekContentModuleRuntime() ?? getContentModuleRuntime(MODULE_CATALOG);
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
          openDocumentOverlay(pointer.targetDocumentId, initialAnchor(), { preferSummary: true });
          return;
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

      let result = await core.getDocument(readableId);
      if (!result.ok && props.reconnectContent) {
        await props.reconnectContent();
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
      if (loadingDocumentId !== documentId) return;
      if (!result.ok) {
        setOpenError(userFacingOpenError(result.error.message));
        return;
      }
      setDocument(result.value);
      loadedOfficialRequestId = documentId;
      setPendingTitle(undefined);
      if (result.value.metadata['contentMode'] === 'esklp-mnn') {
        const refreshedSummaries = await listDocuments(core);
        if (loadingDocumentId !== documentId) return;
        listed = refreshedSummaries;
        setAvailableDocuments(listed);
        setClinicalMedicationLinks(
          selectedMedicationProduct?.mnnDocumentId
            ? parseClinicalMedicationLinks(listed, selectedMedicationProduct.mnnDocumentId)
            : [],
        );
        setSupplementalPanels(
          await loadTradeNameSupplements(
            core,
            listed,
            result.value.id,
            selectedMedicationProduct?.tradeName,
          ),
        );
      }
      let currentTrail = trail();
      if (currentTrail) {
        currentTrail = updateCurrentCrumbTitle(currentTrail, displayDocumentTitle(result.value));
        setTrail(currentTrail);
      }
    } catch (cause) {
      if (loadingDocumentId !== documentId) return;
      setOpenError(cause instanceof Error ? cause.message : 'Не удалось открыть документ.');
    } finally {
      if (loadingDocumentId === documentId) {
        loadingDocumentId = null;
      }
    }
  };

  const requestModulePointerInstall = async (): Promise<void> => {
    const resolution = modulePointer();
    if (resolution?.state !== 'available' || modulePointerPending()) return;
    const runtime = peekContentModuleRuntime() ?? getContentModuleRuntime(MODULE_CATALOG);
    setModulePointerPending(true);
    setModulePointerProgress(null);
    setModulePointerInstallError(null);
    try {
      await installModulePointer(runtime, resolution, setModulePointerProgress);
      if (!props.reconnectContent) {
        throw new Error('Набор загружен, но локальный поиск не удалось обновить.');
      }
      await props.reconnectContent();
      const refreshedCore = props.getCore();
      if (!refreshedCore) throw new Error('Локальный поиск ещё не готов.');
      const listed = await listDocuments(refreshedCore);
      setAvailableDocuments(listed);
      if (!listed.some((item) => item.id === resolution.pointer.targetDocumentId)) {
        throw new Error('Набор загружен, но целевой документ не подключился к поиску.');
      }
      openDocumentOverlay(resolution.pointer.targetDocumentId, initialAnchor(), {
        preferSummary: true,
      });
    } catch (cause) {
      setModulePointerInstallError(
        cause instanceof Error ? cause.message : 'Не удалось загрузить набор документа.',
      );
    } finally {
      setModulePointerPending(false);
      setModulePointerProgress(null);
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
      const runtime = peekContentModuleRuntime() ?? getContentModuleRuntime(MODULE_CATALOG);
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
    setRoute(parsed);
    if (!parsed) {
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
      clearDocumentTrail();
      setTrail(null);
      return;
    }
    const currentTrail = syncTrail(parsed);
    if (parsed.kind === 'official') {
      void loadOfficial(parsed);
      return;
    }
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

  return (
    <Show when={route()}>
      {(activeRoute) => {
        const parsed = activeRoute();
        return (
          <>
            <Show when={parsed.kind === 'user' ? parsed.documentId : null} keyed>
              {(documentId) => (
                <UserDocumentReader
                  documentId={documentId}
                  {...(parsed.kind === 'user' && parsed.pageIndex !== undefined
                    ? { initialPageIndex: parsed.pageIndex }
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
            <Show when={parsed.kind === 'official' ? parsed.documentId : null} keyed>
              <OfficialDocumentReader
                document={document()}
                {...(pendingTitle() ? { pendingTitle: pendingTitle() as string } : {})}
                availableDocuments={availableDocuments()}
                {...(medicationProduct()
                  ? { medicationProduct: medicationProduct() as MedicationProduct }
                  : {})}
                supplementalPanels={supplementalPanels()}
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
                onRequestFullText={requestFullText}
              />
            </Show>
          </>
        );
      }}
    </Show>
  );
}
