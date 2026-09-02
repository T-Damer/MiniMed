import { Capacitor } from '@capacitor/core';

import {
  buildMedicalImagePrintHtml,
  captureMedicalImageFrame,
  type MedicalImagePrintDetail,
  type MedicalImagePrintFrame,
  type MedicalImagePrintOptions,
} from '@/features/library/medical-image-print';
import { printHtmlInNativeShell } from '@/features/printing/native-print';
import { shareSystemFile } from '@/state/native-share';

export type { MedicalImagePrintDetail } from '@/features/library/medical-image-print';

const PRESENTATION_PRINT_STYLES = `
  @page { size: A4 landscape; margin: 20mm 15mm 20mm 30mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .rich-pptx { width: 100%; overflow: visible; border: 0; border-radius: 0; background: #fff; }
  .rich-pptx__wrapper { height: auto !important; overflow: visible !important; background: #fff !important; }
  .rich-pptx__slide { margin: 0 auto !important; break-after: page; page-break-after: always; box-shadow: none; }
  .rich-pptx__slide:last-child { break-after: auto; page-break-after: auto; }
`;

const EPUB_PRINT_STYLES = `
  @page { size: auto; margin: 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { color: #292720; }
`;

const RICH_DOCUMENT_PRINT_STYLES = `
  .rich-sheet__tabs { display: none !important; }
  .rich-sheet { width: 100%; overflow: visible; background: #fff; }
  .rich-sheet__table { width: 100%; border-collapse: collapse; }
  .rich-sheet__cell {
    border: 1px solid #a9a9a9;
    padding: 3px 6px;
    text-align: left;
    vertical-align: top;
  }
`;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function printHtml(html: string, title: string): boolean {
  if (printHtmlInNativeShell(html, title)) return true;
  const popup = window.open('', '_blank');
  if (!popup) return false;
  popup.opener = null;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  printPopup(popup);
  return true;
}

function printPopup(popup: Window): void {
  popup.onafterprint = () => popup.close();
  window.setTimeout(() => {
    const images = popup.document.images ? Array.from(popup.document.images) : [];
    void Promise.all(
      images.map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              image.addEventListener('load', () => resolve(), { once: true });
              image.addEventListener('error', () => resolve(), { once: true });
            }),
      ),
    ).then(() => {
      popup.focus();
      popup.print();
    });
  }, 50);
}

function nativePrintFileName(title: string): string {
  const safeTitle = title
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64);
  return `${safeTitle || 'minimed-document'}.pdf`;
}

async function printOriginal(file: Blob, title: string): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await shareSystemFile({
        title,
        fileName: nativePrintFileName(title),
        mimeType: file.type || 'application/pdf',
        blob: file,
      });
      return result !== 'cancelled';
    } catch (cause) {
      console.warn('Не удалось передать оригинальный файл на печать.', cause);
      return false;
    }
  }

  const url = URL.createObjectURL(file);
  const frame = document.createElement('iframe');
  frame.title = `Печать: ${title}`;
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.opacity = '0';
  frame.style.border = '0';
  frame.src = url;
  return new Promise<boolean>((resolve) => {
    frame.addEventListener(
      'error',
      () => {
        URL.revokeObjectURL(url);
        frame.remove();
        resolve(false);
      },
      { once: true },
    );
    frame.addEventListener(
      'load',
      () => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve(true);
        window.setTimeout(() => {
          URL.revokeObjectURL(url);
          frame.remove();
        }, 60_000);
      },
      { once: true },
    );
    document.body.append(frame);
  });
}

function prepareEpubSection(markup: string): {
  readonly body: string;
  readonly bodyClass: string;
  readonly styles: readonly string[];
} {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  parsed.querySelectorAll('script, iframe, object, embed').forEach((node) => {
    node.remove();
  });
  parsed.querySelectorAll('*').forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || value.startsWith('javascript:')) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  return {
    body: parsed.body.innerHTML,
    bodyClass: parsed.body.getAttribute('class') ?? '',
    styles: Array.from(parsed.head.querySelectorAll('style, link[rel="stylesheet"]')).map(
      (node) => node.outerHTML,
    ),
  };
}

function buildEpubPrintHtml(sections: readonly string[], title: string): string {
  const prepared = sections.map(prepareEpubSection);
  const styles = [...new Set(prepared.flatMap((section) => section.styles))].join('\n');
  const bodyClass = prepared.find((section) => section.bodyClass)?.bodyClass ?? '';
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${EPUB_PRINT_STYLES}</style>
${styles}
</head>
<body class="${escapeHtml(bodyClass)}">${prepared.map((section) => section.body).join('\n')}</body>
</html>`;
}

async function printEpub(file: Blob | Promise<Blob | null>, title: string): Promise<boolean> {
  const native = Capacitor.isNativePlatform();
  const popup = native ? null : window.open('', '_blank');
  if (!native && !popup) return false;
  if (popup) {
    popup.opener = null;
    popup.document.open();
    popup.document.write(
      `<!doctype html><html lang="ru"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head><body>Подготовка документа к печати…</body></html>`,
    );
    popup.document.close();
  }

  let destroyBook: (() => void) | undefined;
  try {
    const source = await file;
    if (!source) {
      popup?.close();
      return false;
    }
    const ePub = (await import('epubjs')).default;
    const book = ePub(await source.arrayBuffer(), { replacements: 'base64' });
    destroyBook = () => {
      void book.destroy();
    };
    await book.opened;
    const sections: Array<Promise<string>> = [];
    book.spine.each((section: { render: (load: unknown) => Promise<string> }) => {
      sections.push(section.render(book.load.bind(book)));
    });
    const html = buildEpubPrintHtml(await Promise.all(sections), title);
    await book.destroy();
    destroyBook = undefined;
    if (printHtmlInNativeShell(html, title)) {
      popup?.close();
      return true;
    }
    if (!popup) return false;
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    printPopup(popup);
    return true;
  } catch (cause) {
    destroyBook?.();
    popup?.close();
    console.warn('Не удалось подготовить EPUB к печати.', cause);
    return false;
  }
}

export interface PrintElementOptions {
  readonly orientation?: 'portrait' | 'landscape';
  readonly margin?: string;
}

function printElement(
  element: HTMLElement,
  title: string,
  options: PrintElementOptions = {},
): boolean {
  const styles = Array.from(element.querySelectorAll('style'))
    .map((style) => `<style>${style.textContent ?? ''}</style>`)
    .join('');
  const pageSize = options.orientation === 'landscape' ? 'A4 landscape' : 'A4';
  const margin = options.margin ?? '20mm 15mm 20mm 30mm';
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>@page { size: ${pageSize}; margin: ${margin}; } body { margin: 0; background: #fff; line-height: 1.5; } p { text-indent: 12.5mm; } .rich-docx__page { break-after: page; page-break-after: always; } .rich-docx__page:last-of-type { break-after: auto; page-break-after: auto; } ${RICH_DOCUMENT_PRINT_STYLES}</style>
${styles}
</head>
<body>${element.outerHTML}</body>
</html>`;
  return printHtml(html, title);
}

function printPresentation(element: HTMLElement, title: string): boolean {
  const styles = Array.from(element.querySelectorAll('style'))
    .map((style) => `<style>${style.textContent ?? ''}</style>`)
    .join('');
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${PRESENTATION_PRINT_STYLES}</style>
${styles}
</head>
<body>${element.outerHTML}</body>
</html>`;
  return printHtml(html, title);
}

function printMedicalImageFrames(
  frames: readonly MedicalImagePrintFrame[],
  title: string,
  options: MedicalImagePrintOptions,
): boolean {
  if (frames.length === 0) return false;
  return printHtml(buildMedicalImagePrintHtml(title, frames, options), title);
}

function printMedicalImageFrame(
  element: HTMLElement,
  title: string,
  details: readonly MedicalImagePrintDetail[],
): boolean {
  let captured: Pick<MedicalImagePrintFrame, 'dataUrl' | 'aspectRatio' | 'annotationSvg'> | null;
  try {
    captured = captureMedicalImageFrame(element, true);
  } catch (cause) {
    console.warn('Не удалось подготовить кадр медицинского изображения к печати.', cause);
    return false;
  }
  if (!captured) return false;
  return printMedicalImageFrames(
    [
      {
        ...captured,
        directionLabel: 'Медицинское изображение',
        sliceLabel: 'Текущий кадр',
        details,
      },
    ],
    title,
    { imagesPerPage: 1, includeAnnotations: true },
  );
}

export const PrintManager = {
  html: printHtml,
  element: printElement,
  presentation: printPresentation,
  original: printOriginal,
  epub: printEpub,
  medicalImageFrame: printMedicalImageFrame,
  medicalImageFrames: printMedicalImageFrames,
} as const;
