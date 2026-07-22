import type { MedicalCore, MedicalDocument } from '@localmed/contracts';
import { createSignal, type JSX, onCleanup, onMount } from 'solid-js';

import { OPEN_DOCUMENT_EVENT, type OpenDocumentRequest } from '../../state/document-navigation';
import { DocumentReaderDialog } from './DocumentReaderDialog';

interface DocumentOverlayHostProps {
  readonly core: MedicalCore;
}

function parseRequest(value: unknown): OpenDocumentRequest | null {
  if (typeof value === 'string' && value) return { documentId: value, anchor: null };
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (typeof candidate['documentId'] !== 'string' || !candidate['documentId']) return null;
  return {
    documentId: candidate['documentId'],
    anchor: typeof candidate['anchor'] === 'string' ? candidate['anchor'] : null,
  };
}

export function DocumentOverlayHost(props: DocumentOverlayHostProps): JSX.Element {
  const [selectedDocument, setSelectedDocument] = createSignal<MedicalDocument>();
  const [anchor, setAnchor] = createSignal<string | null>(null);

  const open = async (request: OpenDocumentRequest): Promise<void> => {
    const result = await props.core.getDocument(request.documentId);
    if (!result.ok) return;
    setAnchor(request.anchor ?? null);
    setSelectedDocument(result.value);
    if (request.anchor) {
      requestAnimationFrame(() => {
        window.document.getElementById(request.anchor ?? '')?.scrollIntoView({ block: 'center' });
      });
    }
  };

  const handleOpen = (event: Event): void => {
    const request = parseRequest((event as CustomEvent<unknown>).detail);
    if (request) void open(request);
  };

  onMount(() => window.addEventListener(OPEN_DOCUMENT_EVENT, handleOpen));
  onCleanup(() => window.removeEventListener(OPEN_DOCUMENT_EVENT, handleOpen));

  return (
    <DocumentReaderDialog
      document={selectedDocument()}
      initialAnchor={anchor()}
      onClose={() => {
        setSelectedDocument(undefined);
        setAnchor(null);
      }}
    />
  );
}
