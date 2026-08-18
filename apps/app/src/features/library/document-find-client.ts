import {
  type DocumentFindMatch,
  type DocumentFindMode,
  type DocumentFindUnit,
  findInUnits,
} from '@/features/library/document-find';
import type {
  DocumentFindWorkerRequest,
  DocumentFindWorkerResponse,
} from '@/features/library/document-find-protocol';

export class DocumentFindClient {
  private worker: Worker | undefined;
  private readonly pending = new Map<
    number,
    {
      readonly query: string;
      readonly mode: DocumentFindMode;
      readonly resolve: (matches: readonly DocumentFindMatch[]) => void;
    }
  >();
  private requestId = 0;
  private latestFindId = 0;
  private units: readonly DocumentFindUnit[] = [];
  private workerFailed = false;
  private allowWorker: boolean;

  public constructor(options?: { readonly allowWorker?: boolean }) {
    this.allowWorker = options?.allowWorker ?? true;
    if (!this.allowWorker || typeof Worker === 'undefined') return;
    const worker = new Worker(new URL('./document-find.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<DocumentFindWorkerResponse>) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      if (event.data.id !== this.latestFindId) return;
      if ('error' in event.data) {
        pending.resolve(findInUnits(this.units, pending.query, pending.mode));
        return;
      }
      pending.resolve(event.data.matches);
    };
    worker.onerror = () => {
      this.workerFailed = true;
      this.resolvePendingOnMainThread();
      this.disableWorker();
    };
  }

  public setUnits(units: readonly DocumentFindUnit[]): void {
    this.units = units;
    if (!this.canUseWorker()) return;
    this.worker?.postMessage({
      id: ++this.requestId,
      type: 'set-units',
      units,
    } satisfies DocumentFindWorkerRequest);
  }

  public find(query: string, mode: DocumentFindMode): Promise<readonly DocumentFindMatch[]> {
    const trimmed = query.trim();
    if (!trimmed) return Promise.resolve([]);
    const id = ++this.requestId;
    this.latestFindId = id;
    if (!this.canUseWorker()) {
      return Promise.resolve(findInUnits(this.units, trimmed, mode));
    }
    return new Promise((resolve) => {
      this.pending.set(id, { query: trimmed, mode, resolve });
      this.worker?.postMessage({
        id,
        type: 'find',
        query: trimmed,
        mode,
      } satisfies DocumentFindWorkerRequest);
    });
  }

  public dispose(): void {
    this.disableWorker();
  }

  private canUseWorker(): boolean {
    return Boolean(this.worker) && !this.workerFailed && this.allowWorker;
  }

  private resolvePendingOnMainThread(): void {
    for (const [id, pending] of this.pending) {
      if (id !== this.latestFindId) continue;
      pending.resolve(findInUnits(this.units, pending.query, pending.mode));
    }
    this.pending.clear();
  }

  private disableWorker(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.resolvePendingOnMainThread();
  }
}
