import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

function assetUrl(path: string): string {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  return new URL(`pdfjs/${path}`, base).href;
}

export async function loadPdfJsDocument(blob: Blob): Promise<pdfjs.PDFDocumentProxy> {
  const data = await blob.arrayBuffer();
  return await pdfjs.getDocument({
    data,
    cMapUrl: assetUrl('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts/'),
    wasmUrl: assetUrl('wasm/'),
    iccUrl: assetUrl('iccs/'),
    useWasm: true,
    useWorkerFetch: true,
  }).promise;
}

export type PdfDocumentProxy = pdfjs.PDFDocumentProxy;
export type PdfPageProxy = pdfjs.PDFPageProxy;
