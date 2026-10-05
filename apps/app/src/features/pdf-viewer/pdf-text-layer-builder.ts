import { TextLayer } from 'pdfjs-dist';

import type { PdfDocumentProxy } from '@/state/pdfjs-document';

/** Text items laid out per slice; between slices the main thread is handed back. */
const ITEMS_PER_SLICE = 8;

function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

/**
 * Builds the selectable text layer of a page in small slices. pdf.js measures every text item with
 * `canvas.measureText` to fit its width, which costs milliseconds per item on a phone; one pass over
 * a dense page would block scrolling for a second or more. Slices of a few items, built off-screen
 * and swapped in when complete, keep frames flowing. Marked-content markers are dropped (they only
 * wrap spans), so slices are independent and item `i` stays `textDivs[i]`.
 */
export class PdfTextLayerBuilder {
  private readonly host: HTMLElement;
  private divs: readonly HTMLElement[] = [];
  private builtWidth = 0;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  /** The spans in text-item order, as `buildPdfPageText` numbers them. */
  get textDivs(): readonly HTMLElement[] {
    return this.divs;
  }

  /** CSS width of the page the layer was laid out for; 0 while there is no layer. */
  get layoutWidth(): number {
    return this.builtWidth;
  }

  get ready(): boolean {
    return this.divs.length > 0 || this.builtWidth > 0;
  }

  /** Follows a size change cheaply: spans are positioned in percent, only the font scale moves. */
  setCssWidth(cssWidth: number, pageWidth: number): void {
    if (pageWidth > 0)
      this.host.style.setProperty('--total-scale-factor', String(cssWidth / pageWidth));
  }

  /** Resolves false when cancelled; the previous layer stays until a new one is complete. */
  async build(
    pdf: PdfDocumentProxy,
    pageNumber: number,
    cssWidth: number,
    isCancelled: () => boolean,
  ): Promise<boolean> {
    const page = await pdf.getPage(pageNumber);
    try {
      const base = page.getViewport({ scale: 1 });
      const scale = cssWidth / base.width;
      const viewport = page.getViewport({ scale });
      const content = await page.getTextContent();
      if (isCancelled()) return false;
      const items = content.items.filter((item) => 'str' in item);
      const staging = document.createElement('div');
      const layers: TextLayer[] = [];
      for (let start = 0; start < items.length; start += ITEMS_PER_SLICE) {
        const layer = new TextLayer({
          textContentSource: {
            items: items.slice(start, start + ITEMS_PER_SLICE),
            styles: content.styles,
            lang: content.lang,
          },
          container: staging,
          viewport,
        });
        await layer.render();
        layers.push(layer);
        if (isCancelled()) {
          for (const done of layers) done.cancel();
          return false;
        }
        if (start + ITEMS_PER_SLICE < items.length) await yieldToMain();
        if (isCancelled()) {
          for (const done of layers) done.cancel();
          return false;
        }
      }
      const divs = layers.flatMap((layer) => layer.textDivs);
      for (const div of divs) div.classList.add('pdf-viewer__text-run');
      this.host.style.setProperty('--total-scale-factor', String(scale));
      this.host.replaceChildren(...Array.from(staging.childNodes));
      this.divs = divs;
      this.builtWidth = cssWidth;
      return true;
    } finally {
      page.cleanup();
    }
  }

  clear(): void {
    this.host.replaceChildren();
    this.divs = [];
    this.builtWidth = 0;
  }
}
