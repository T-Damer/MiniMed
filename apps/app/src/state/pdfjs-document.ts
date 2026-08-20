import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

function assetUrl(path: string): string {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  return new URL(`pdfjs/${path}`, base).href;
}

export type PdfDocumentProxy = pdfjs.PDFDocumentProxy & {
  destroy(): Promise<void>;
};

export async function loadPdfJsDocument(blob: Blob): Promise<PdfDocumentProxy> {
  const data = await blob.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data,
    cMapUrl: assetUrl('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts/'),
    wasmUrl: assetUrl('wasm/'),
    iccUrl: assetUrl('iccs/'),
    useWasm: true,
    useWorkerFetch: true,
  });
  const document = await loadingTask.promise;
  return Object.assign(document, { destroy: () => loadingTask.destroy() });
}

export type PdfPageProxy = pdfjs.PDFPageProxy;
