import { Capacitor } from '@capacitor/core';
import arrowLeftBold from '@phosphor-icons/core/assets/bold/arrow-left-bold.svg?raw';
import shareFatBold from '@phosphor-icons/core/assets/bold/share-fat-bold.svg?raw';
import {
  documentPreviewPages,
  PRINT_DOCUMENT_PAGE_WIDTH,
} from '@/features/printing/document-print-preview';
import {
  NATIVE_PRINT_CRUMBS_CLASS,
  NATIVE_PRINT_HEADER_CLASS,
  NATIVE_PRINT_ICON_BUTTON_CLASS,
  NATIVE_PRINT_SHARE_BUTTON_CLASS,
  NATIVE_PRINT_TITLE_CLASS,
} from '@/features/printing/native-print-chrome';
import { computePrintPreviewLayout } from '@/features/printing/native-print-fit';
import {
  clipNativePrintShareText,
  shareNativePrintContent,
} from '@/features/printing/native-print-share';
import { nativeAndroidShareText, shareSystemFile } from '@/state/native-share';

let stopDocumentResize: (() => void) | undefined;

function removePreview(): void {
  stopDocumentResize?.();
  stopDocumentResize = undefined;
  document.querySelector<HTMLElement>('.native-print-preview')?.remove();
  document.documentElement.classList.remove('native-print-active');
  window.removeEventListener('afterprint', removePreview);
}

function glyphSvg(raw: string, className: string): string {
  const body = raw.slice(raw.indexOf('>') + 1, raw.lastIndexOf('</svg>'));
  return `<svg class="app-glyph ${className}" viewBox="0 0 256 256" aria-hidden="true" fill="currentColor">${body}</svg>`;
}

function iconButton(className: string, label: string, glyph: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-label', label);
  button.title = label;
  const icon = document.createElement('span');
  icon.className = 'ui-button__icon';
  icon.innerHTML = glyph;
  button.append(icon);
  return button;
}

function stripHtmlText(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return parsed.body.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

async function inlineBlobImages(html: string): Promise<string> {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const image of Array.from(parsed.querySelectorAll<HTMLImageElement>('img[src^="blob:"]'))) {
    const source = image.getAttribute('src');
    if (!source) continue;
    const response = await fetch(source);
    if (!response.ok) throw new Error('Не удалось подготовить изображение к передаче.');
    image.setAttribute('src', await blobToDataUrl(await response.blob()));
  }
  return `<!doctype html>\n${parsed.documentElement.outerHTML}`;
}

function nativePrintFileName(title: string): string {
  const safeTitle = title
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64);
  return `${safeTitle || 'minimed-print'}.html`;
}

function fitPreviewSheet(sheet: HTMLElement, content: HTMLElement, scaler: HTMLElement): void {
  const styles = getComputedStyle(sheet);
  const paddingX = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
  const paddingY = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
  const availableWidth = Math.max(0, sheet.clientWidth - paddingX);
  const availableHeight = Math.max(0, sheet.clientHeight - paddingY);
  const { scale, flow } = computePrintPreviewLayout(
    content.scrollWidth,
    content.scrollHeight,
    availableWidth,
    availableHeight,
  );
  sheet.classList.toggle('native-print-preview__sheet--flow', flow);
  scaler.style.transform = `scale(${scale})`;
  scaler.style.transformOrigin = 'top left';
  scaler.style.width = `${100 / scale}%`;
  content.style.width = `${100 / scale}%`;
  // A transform leaves the layout box as it was: the flowing sheet takes the scaled height.
  scaler.style.height = flow ? `${content.scrollHeight * scale}px` : '';
}

async function shareOrPrint(title: string, html: string): Promise<void> {
  const text = clipNativePrintShareText([title, stripHtmlText(html)].filter(Boolean).join('\n\n'));
  const canWebShare = 'share' in navigator && typeof navigator.share === 'function';
  await shareNativePrintContent({
    title,
    text,
    platform: Capacitor.getPlatform(),
    fileShare: async () =>
      shareSystemFile({
        title,
        fileName: nativePrintFileName(title),
        mimeType: 'text/html',
        blob: new Blob([await inlineBlobImages(html)], { type: 'text/html;charset=utf-8' }),
      }),
    androidShare: (payload) => nativeAndroidShareText(payload.title, payload.text),
    ...(canWebShare
      ? {
          webShare: (payload: { readonly title: string; readonly text: string }) =>
            navigator.share(payload),
        }
      : {}),
    print: () => window.print(),
  });
}

export function printHtmlInNativeShell(html: string, title: string): boolean {
  if (!Capacitor.isNativePlatform()) return false;

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const preview = document.createElement('section');
  preview.className = 'native-print-preview';
  preview.setAttribute('aria-label', `Печать: ${title}`);

  const header = document.createElement('header');
  header.className = NATIVE_PRINT_HEADER_CLASS;

  const back = iconButton(
    NATIVE_PRINT_ICON_BUTTON_CLASS,
    'Назад',
    glyphSvg(arrowLeftBold, 'document-page__back-icon'),
  );
  back.setAttribute('data-native-print-back', 'true');
  back.addEventListener('click', removePreview, { once: true });

  const action = iconButton(
    NATIVE_PRINT_SHARE_BUTTON_CLASS,
    'Поделиться',
    glyphSvg(shareFatBold, 'document-page__back-icon'),
  );
  action.addEventListener('click', () => {
    void shareOrPrint(title, html);
  });

  const crumbs = document.createElement('nav');
  crumbs.className = NATIVE_PRINT_CRUMBS_CLASS;
  crumbs.setAttribute('aria-label', title);
  const list = document.createElement('ol');
  list.className = 'document-crumbs__list';
  const item = document.createElement('li');
  item.className = 'document-crumbs__item';
  const heading = document.createElement('span');
  heading.className = NATIVE_PRINT_TITLE_CLASS;
  heading.textContent = title;
  item.append(heading);
  list.append(item);
  crumbs.append(list);
  header.append(back, action, crumbs);

  const stage = document.createElement('div');
  stage.className = 'native-print-preview__stage';

  const presentationSlides = Array.from(
    parsed.querySelectorAll<HTMLElement>('.rich-pptx__slide, .pptx-preview-slide-wrapper'),
  );
  if (presentationSlides.length > 0) {
    preview.classList.add('native-print-preview--presentation');
  }
  if (parsed.querySelector('.rich-sheet')) {
    preview.classList.add('native-print-preview--landscape');
  }
  const printDocument = parsed.body.classList.contains('doc-print');
  preview.classList.toggle('native-print-preview--document', printDocument);
  const printableFragments =
    presentationSlides.length > 0
      ? presentationSlides.map((slide) => slide.outerHTML)
      : [parsed.body.innerHTML];

  for (const fragment of printableFragments) {
    const sheet = document.createElement('article');
    sheet.className = 'native-print-preview__sheet';

    const scaler = document.createElement('div');
    scaler.className = 'native-print-preview__sheet-scaler';

    const content = document.createElement('div');
    content.className = 'native-print-preview__content';
    const headStyles = Array.from(parsed.head.querySelectorAll('style'))
      .map((style) => style.outerHTML)
      .join('');
    content.innerHTML = `${headStyles}${fragment}`;
    for (const table of Array.from(content.querySelectorAll('table'))) {
      table.classList.add('native-print-preview__table');
    }
    for (const cell of Array.from(content.querySelectorAll('th, td'))) {
      cell.classList.add('native-print-preview__cell');
    }

    scaler.append(content);
    sheet.append(scaler);
    stage.append(sheet);
    if (printDocument) {
      const images = Array.from(content.querySelectorAll('img')).filter((image) => !image.complete);
      void Promise.allSettled(images.map((image) => image.decode())).then(() => {
        window.requestAnimationFrame(() => {
          if (!sheet.isConnected) return;
          const pages = documentPreviewPages(content);
          if (pages.length === 0) return;
          const styles = Array.from(content.querySelectorAll('style'));
          stage.replaceChildren();
          for (const page of pages) {
            const paper = sheet.cloneNode(false) as HTMLElement;
            const paperScaler = scaler.cloneNode(false) as HTMLElement;
            const paperBody = content.cloneNode(false) as HTMLElement;
            paperBody.append(page.content);
            paperScaler.append(paperBody);
            paper.append(paperScaler);
            paper.style.setProperty('--print-page-overflow', `${page.overflow}px`);
            stage.append(paper);
          }
          stage.prepend(...styles);
          const measure = (): void => {
            const first = stage.querySelector<HTMLElement>('.native-print-preview__sheet');
            if (!first) return;
            stage.style.setProperty(
              '--print-page-scale',
              String(first.clientWidth / PRINT_DOCUMENT_PAGE_WIDTH),
            );
          };
          measure();
          const resize = new ResizeObserver(measure);
          resize.observe(preview);
          stopDocumentResize = () => resize.disconnect();
        });
      });
    } else {
      window.requestAnimationFrame(() => fitPreviewSheet(sheet, content, scaler));
    }
  }
  preview.append(header, stage);

  removePreview();
  window.scrollTo(0, 0);
  document.body.append(preview);
  document.documentElement.classList.add('native-print-active');
  window.addEventListener('afterprint', removePreview, { once: true });

  return true;
}
