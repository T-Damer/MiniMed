import type { MedicalCore, MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';
import { fullDocumentCandidateIds } from '@localmed/core';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { OverlayDialog } from '@/components/OverlayDialog';
import { DocumentReaderDialog } from '@/features/library/DocumentReaderDialog';
import { resolveReadableDocumentId } from '@/features/library/document-display';
import { MODULE_CATALOG } from '@/features/modules/module-catalog';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
import { OPEN_DOCUMENT_EVENT, type OpenDocumentRequest } from '@/state/document-navigation';

interface DocumentOverlayHostProps {
  readonly getCore: () => MedicalCore | undefined;
  readonly reconnectContent?: () => Promise<void>;
}

function parseRequest(value: unknown): OpenDocumentRequest | null {
  if (typeof value === 'string' && value) return { documentId: value, anchor: null };
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (typeof candidate['documentId'] !== 'string' || !candidate['documentId']) return null;
  return {
    documentId: candidate['documentId'],
    anchor: typeof candidate['anchor'] === 'string' ? candidate['anchor'] : null,
    preferSummary: candidate['preferSummary'] === true,
  };
}

function userFacingOpenError(message: string): string {
  if (message.includes('Document not found')) {
    return 'Документ пока не подключён к поиску. Подождите завершения установки или нажмите «Повторить» в разделе скачивания.';
  }
  return message;
}

export function DocumentOverlayHost(props: DocumentOverlayHostProps): JSX.Element {
  const [openedDocuments, setOpenedDocuments] = createSignal<
    readonly {
      readonly id: string;
      readonly document: MedicalDocument;
      readonly anchor: string | null;
    }[]
  >([]);
  const [availableDocuments, setAvailableDocuments] = createSignal<
    readonly MedicalDocumentSummary[]
  >([]);
  const [loading, setLoading] = createSignal(false);
  const [loadingTitle, setLoadingTitle] = createSignal('Открываем документ');
  const [openError, setOpenError] = createSignal<string | null>(null);

  const listDocuments = async (core: MedicalCore): Promise<readonly MedicalDocumentSummary[]> => {
    const list = await core.listDocuments();
    return list.ok ? list.value : [];
  };

  const resolveDocumentId = async (
    core: MedicalCore,
    documentId: string,
    preferSummary: boolean,
  ): Promise<string> => {
    const documents = await listDocuments(core);
    setAvailableDocuments(documents);
    const availableIds = new Set(documents.map((document) => document.id));
    if (preferSummary) return documentId;
    return resolveReadableDocumentId(documentId, availableIds);
  };

  const loadDocument = async (
    core: MedicalCore,
    request: OpenDocumentRequest,
  ): Promise<MedicalDocument | null> => {
    const documentId = await resolveDocumentId(
      core,
      request.documentId,
      request.preferSummary === true,
    );
    const result = await core.getDocument(documentId);
    if (result.ok) return result.value;
    if (!props.reconnectContent) return null;
    await props.reconnectContent();
    const refreshedCore = props.getCore();
    if (!refreshedCore) return null;
    const refreshedId = await resolveDocumentId(
      refreshedCore,
      request.documentId,
      request.preferSummary === true,
    );
    const retry = await refreshedCore.getDocument(refreshedId);
    return retry.ok ? retry.value : null;
  };

  const open = async (request: OpenDocumentRequest): Promise<void> => {
    const core = props.getCore();
    if (!core) {
      setOpenError('Локальный поиск ещё не готов.');
      return;
    }
    setOpenError(null);
    setLoadingTitle('Открываем документ');
    setLoading(true);
    try {
      const document = await loadDocument(core, request);
      if (!document) {
        const latestCore = props.getCore();
        const failure = latestCore
          ? await latestCore.getDocument(request.documentId)
          : { ok: false as const, error: { message: 'Локальный поиск ещё не готов.' } };
        setOpenError(
          userFacingOpenError(failure.ok ? 'Не удалось открыть документ.' : failure.error.message),
        );
        return;
      }
      setOpenedDocuments((current) => [
        ...current,
        {
          id: `${document.id}:${Date.now().toString(36)}`,
          document,
          anchor: request.anchor ?? null,
        },
      ]);
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : 'Не удалось открыть документ.');
    } finally {
      setLoading(false);
    }
  };

  const requestFullText = async (openedId: string, summary: MedicalDocument): Promise<void> => {
    let core = props.getCore();
    if (!core) throw new Error('Локальный поиск ещё не готов.');
    let documents = await listDocuments(core);
    let fullDocumentId = resolveReadableDocumentId(
      summary.id,
      new Set(documents.map((document) => document.id)),
    );
    let readerHidden = false;
    try {
      if (fullDocumentId === summary.id) {
        const runtime = peekContentModuleRuntime() ?? getContentModuleRuntime(MODULE_CATALOG);
        const candidateIds = new Set(fullDocumentCandidateIds(summary.id));
        const matchingModules = runtime
          .getCatalog()
          .modules.filter(
            (module) =>
              module.releaseState === 'published' &&
              module.documents.some((document) => candidateIds.has(document.documentId)),
          );
        const module =
          matchingModules.find((candidate) =>
            candidate.tags.includes('individual-recommendation'),
          ) ?? matchingModules[0];
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
        setLoadingTitle('Подключаем полную версию');
        setLoading(true);
        readerHidden = true;
        await props.reconnectContent();
        core = props.getCore();
        if (!core) throw new Error('Локальный поиск ещё не готов.');
        documents = await listDocuments(core);
        fullDocumentId = resolveReadableDocumentId(
          summary.id,
          new Set(documents.map((document) => document.id)),
        );
      } else {
        setLoadingTitle('Открываем полную версию');
        setLoading(true);
        readerHidden = true;
      }

      if (fullDocumentId === summary.id) {
        throw new Error('Полная рекомендация загружена, но не подключилась к локальной базе.');
      }
      const result = await core.getDocument(fullDocumentId);
      if (!result.ok) throw new Error(userFacingOpenError(result.error.message));
      setAvailableDocuments(documents);
      setOpenedDocuments((current) =>
        current.map((opened) =>
          opened.id === openedId ? { ...opened, document: result.value, anchor: null } : opened,
        ),
      );
    } finally {
      if (readerHidden) setLoading(false);
    }
  };

  const handleOpen = (event: Event): void => {
    const request = parseRequest((event as CustomEvent<unknown>).detail);
    if (request) void open(request);
  };

  onMount(() => window.addEventListener(OPEN_DOCUMENT_EVENT, handleOpen));
  onCleanup(() => window.removeEventListener(OPEN_DOCUMENT_EVENT, handleOpen));

  return (
    <>
      <Show when={loading()}>
        <OverlayDialog
          open
          title={loadingTitle()}
          subtitle="Загружаем полный текст из локальной базы"
          class="document-overlay-loading"
          onClose={() => {
            setLoading(false);
            setOpenError('Открытие документа отменено.');
          }}
        >
          <p class="document-overlay-loading-note">
            Это может занять несколько секунд для больших КР.
          </p>
        </OverlayDialog>
      </Show>

      <Show when={openError()}>
        {(message) => (
          <OverlayDialog
            open
            title="Не удалось открыть документ"
            class="document-overlay-error"
            onClose={() => setOpenError(null)}
          >
            <p>{message()}</p>
          </OverlayDialog>
        )}
      </Show>

      <Show when={!loading()}>
        <For each={openedDocuments()}>
          {(opened, index) => (
            <DocumentReaderDialog
              document={opened.document}
              availableDocuments={availableDocuments()}
              initialAnchor={opened.anchor}
              onRequestFullText={(document) => requestFullText(opened.id, document)}
              onClose={() => {
                setOpenedDocuments((current) => current.slice(0, index()));
              }}
            />
          )}
        </For>
      </Show>
    </>
  );
}
