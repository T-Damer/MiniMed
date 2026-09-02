import { type JSX, onCleanup, onMount } from 'solid-js';
import { SpreadsheetRenderer } from '@/features/library/SpreadsheetRenderer';
import { pageAnchorId } from '@/features/library/user-document-reader-helpers';
import { getUserLibraryFile, userLibraryFileCapability } from '@/state/user-library';

function isEpubMime(mimeType: string): boolean {
  return userLibraryFileCapability(mimeType).reader.renderer === 'epub';
}

export function isSheetMime(mimeType: string): boolean {
  return userLibraryFileCapability(mimeType).reader.renderer === 'sheet';
}

export function isPresentationMime(mimeType: string): boolean {
  return userLibraryFileCapability(mimeType).reader.renderer === 'presentation';
}

export function isDocxMime(mimeType: string): boolean {
  return userLibraryFileCapability(mimeType).reader.renderer === 'docx';
}

export function isRichDocumentMime(mimeType: string): boolean {
  const renderer = userLibraryFileCapability(mimeType).reader.renderer;
  return (
    renderer === 'epub' ||
    renderer === 'docx' ||
    renderer === 'sheet' ||
    renderer === 'presentation'
  );
}

/**
 * Renders original EPUB (epub.js), Office Open XML, and spreadsheet files instead
 * of the extracted plain-text fallback. Text extraction still powers search.
 */
export function RichDocumentRenderer(props: {
  readonly documentId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly fullscreen?: boolean;
  readonly activeSheetName?: string;
  readonly onSheetNamesChange?: (sheetNames: readonly string[]) => void;
  readonly onActiveSheetChange?: (sheetName: string) => void;
  readonly onExitFullscreen?: () => void;
  readonly onPresentationSlideClick?: (slide: HTMLElement) => void;
}): JSX.Element {
  if (isSheetMime(props.mimeType)) {
    return (
      <SpreadsheetRenderer
        documentId={props.documentId}
        fileName={props.fileName}
        mimeType={props.mimeType}
        fullscreen={props.fullscreen}
        activeSheetName={props.activeSheetName}
        onSheetNamesChange={props.onSheetNamesChange}
        onActiveSheetChange={props.onActiveSheetChange}
        onExitFullscreen={props.onExitFullscreen}
      />
    );
  }

  let host!: HTMLDivElement;

  onMount(() => {
    let disposed = false;
    let destroyBook: (() => void) | undefined;
    void getUserLibraryFile(props.documentId)
      .then(async (blob) => {
        if (!blob || disposed) return;
        const buffer = await blob.arrayBuffer();
        if (disposed) return;
        try {
          if (isEpubMime(props.mimeType)) {
            const ePub = (await import('epubjs')).default;
            if (disposed) return;
            const book = ePub(buffer as ArrayBuffer);
            host.classList.add('rich-document-renderer--epub');
            const rendition = book.renderTo(host, {
              width: '100%',
              height: '100%',
              manager: 'continuous',
              flow: 'scrolled-continuous',
            });
            await rendition.display();
            if (disposed) {
              await rendition.destroy();
              await book.destroy();
              return;
            }
            rendition.themes.fontSize('100%');
            destroyBook = () => {
              void rendition.destroy();
              void book.destroy();
            };
            return;
          }
          if (isPresentationMime(props.mimeType)) {
            const { init } = await import('pptx-preview');
            if (disposed) return;
            host.classList.add('rich-pptx');
            const previewer = init(host, {
              width: Math.round(host.clientWidth || 900),
              mode: 'list',
            });
            await previewer.preview(buffer);
            if (disposed) return;
            host.style.overflow = 'visible';
            const wrapper = host.querySelector<HTMLElement>('.pptx-preview-wrapper');
            wrapper?.classList.add('rich-pptx__wrapper');
            wrapper?.style.setProperty('height', 'auto');
            wrapper?.style.setProperty('overflow', 'visible');
            wrapper
              ?.querySelectorAll<HTMLElement>('.pptx-preview-slide-wrapper')
              .forEach((slide, index) => {
                slide.classList.add('rich-pptx__slide');
                if (props.onPresentationSlideClick) {
                  slide.tabIndex = 0;
                  slide.setAttribute('role', 'button');
                  slide.setAttribute('aria-label', `Открыть слайд ${String(index + 1)} крупно`);
                  const openSlide = (): void => props.onPresentationSlideClick?.(slide);
                  slide.addEventListener('click', openSlide);
                  slide.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    openSlide();
                  });
                }
              });
            destroyBook = () => {
              host.replaceChildren();
            };
            return;
          }
          if (isDocxMime(props.mimeType)) {
            const docx = await import('docx-preview');
            if (disposed) return;
            host.classList.add('rich-docx');
            await docx.renderAsync(buffer, host, undefined, {
              inWrapper: true,
              breakPages: true,
              ignoreLastRenderedPageBreak: false,
            });
            const wrapper = host.querySelector<HTMLElement>('.docx-wrapper');
            wrapper?.classList.add('rich-docx__wrapper');
            wrapper?.querySelectorAll<HTMLElement>('section.docx').forEach((page, index) => {
              page.classList.add('rich-docx__page');
              page.id = pageAnchorId(props.documentId, index);
              page.setAttribute('data-user-doc-anchor', '');
              page.setAttribute('aria-label', `Страница ${String(index + 1)}`);
            });
          }
        } catch {
          if (!disposed) host.textContent = 'Не удалось отобразить документ в исходном виде.';
        }
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        host.textContent =
          cause instanceof Error ? cause.message : 'Не удалось загрузить документ в исходном виде.';
      });
    onCleanup(() => {
      disposed = true;
      destroyBook?.();
      host.replaceChildren();
    });
  });

  return <div ref={host} class="rich-document-renderer" />;
}
