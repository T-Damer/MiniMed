import { parseMarkdownDocument } from './markdown-parser';

interface MarkdownWorkerRequest {
  readonly requestId: number;
  readonly markdown: string;
}

interface MarkdownWorkerResponse {
  readonly requestId: number;
  readonly document?: ReturnType<typeof parseMarkdownDocument>;
  readonly error?: string;
}

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<MarkdownWorkerRequest>) => void) | null;
  postMessage: (message: MarkdownWorkerResponse) => void;
};

workerScope.onmessage = (event) => {
  try {
    workerScope.postMessage({
      requestId: event.data.requestId,
      document: parseMarkdownDocument(event.data.markdown),
    });
  } catch (error) {
    workerScope.postMessage({
      requestId: event.data.requestId,
      error: error instanceof Error ? error.message : 'Не удалось разобрать Markdown.',
    });
  }
};
