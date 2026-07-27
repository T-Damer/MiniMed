import type { MedicalCore, MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';
import { createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { OverlayDialog } from '@/components/OverlayDialog';
import { DocumentReaderDialog } from '@/features/library/DocumentReaderDialog';
import { resolveReadableDocumentId } from '@/features/library/document-display';
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
      if (request.anchor) {
        requestAnimationFrame(() => {
          window.document.getElementById(request.anchor ?? '')?.scrollIntoView({ block: 'center' });
        });
      }
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : 'Не удалось открыть документ.');
    } finally {
      setLoading(false);
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
          title="Открываем документ"
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

      <For each={openedDocuments()}>
        {(opened, index) => (
          <DocumentReaderDialog
            document={opened.document}
            availableDocuments={availableDocuments()}
            initialAnchor={opened.anchor}
            onClose={() => {
              setOpenedDocuments((current) => current.slice(0, index()));
            }}
          />
        )}
      </For>
    </>
  );
}
