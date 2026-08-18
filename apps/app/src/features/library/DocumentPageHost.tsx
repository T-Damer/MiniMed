import type { MedicalCore, MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';
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
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
import { consumePreferSummaryDocumentId } from '@/state/document-navigation';
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
  const [openError, setOpenError] = createSignal<string | null>(null);
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
    setInitialAnchor(parsed.section ?? null);

    if (
      !shouldReloadOfficialDocument(
        loadedOfficialRequestId ?? document()?.id,
        documentId,
        loadingDocumentId,
      )
    ) {
      return;
    }

    loadingDocumentId = documentId;
    loadedOfficialRequestId = null;
    setOpenError(null);
    setDocument(undefined);
    setPendingTitle('Открываем документ');

    const core = props.getCore();
    if (!core) {
      loadingDocumentId = null;
      setOpenError('Локальный поиск ещё не готов.');
      return;
    }

    const preferSummaryId = consumePreferSummaryDocumentId();
    const preferSummary = preferSummaryId === documentId;

    try {
      const listed = await listDocuments(core);
      if (loadingDocumentId !== documentId) return;
      setAvailableDocuments(listed);
      const availableIds = new Set(listed.map((item) => item.id));
      const readableId = preferSummary
        ? documentId
        : resolveReadableDocumentId(documentId, availableIds);
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

  const requestFullText = async (summary: MedicalDocument): Promise<void> => {
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
        const completed = await runtime.wait(task.id);
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
      setPendingTitle(undefined);
      setOpenError(null);
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
    loadedOfficialRequestId = null;
    setPendingTitle(undefined);
    setOpenError(null);
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
                initialAnchor={initialAnchor()}
                trail={trail()}
                openError={openError()}
                onNavigate={navigateTrail}
                onRequestFullText={requestFullText}
              />
            </Show>
          </>
        );
      }}
    </Show>
  );
}
