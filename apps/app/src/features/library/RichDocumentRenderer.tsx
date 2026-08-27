import { type JSX, onCleanup, onMount } from 'solid-js';

import { getUserLibraryFile } from '@/state/user-library';

function isEpubMime(mimeType: string): boolean {
  return mimeType === 'application/epub+zip';
}

export function isSheetMime(mimeType: string): boolean {
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'text/csv'
  );
}

export function isPresentationMime(mimeType: string): boolean {
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.ms-powerpoint'
  );
}

export function isDocxMime(mimeType: string): boolean {
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  );
}

export function isRichDocumentMime(mimeType: string): boolean {
  return (
    isEpubMime(mimeType) ||
    isDocxMime(mimeType) ||
    isSheetMime(mimeType) ||
    isPresentationMime(mimeType)
  );
}

/**
 * Renders original EPUB (epub.js) and DOC/DOCX (docx-preview) files instead
 * of the extracted plain-text fallback. Text extraction still powers search.
 */
export function RichDocumentRenderer(props: {
  readonly documentId: string;
  readonly mimeType: string;
}): JSX.Element {
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
          if (isSheetMime(props.mimeType)) {
            const XLSX = await import('xlsx');
            if (disposed) return;
            const workbook = XLSX.read(buffer, { type: 'array' });
            host.classList.add('rich-sheet');
            const tabs = document.createElement('div');
            tabs.className = 'rich-sheet__tabs';
            const tables = document.createElement('div');
            workbook.SheetNames.forEach((sheetName, index) => {
              const tab = document.createElement('button');
              tab.type = 'button';
              tab.className = `rich-sheet__tab${index === 0 ? ' rich-sheet__tab--active' : ''}`;
              tab.textContent = sheetName;
              tab.addEventListener('click', () => {
                for (const item of Array.from(tabs.children))
                  item.classList.remove('rich-sheet__tab--active');
                tab.classList.add('rich-sheet__tab--active');
                tables.replaceChildren();
                tables.insertAdjacentHTML(
                  'beforeend',
                  XLSX.utils.sheet_to_html(workbook.Sheets[sheetName] ?? XLSX.utils.book_new()),
                );
              });
              tabs.append(tab);
              if (index === 0) {
                tables.insertAdjacentHTML(
                  'beforeend',
                  XLSX.utils.sheet_to_html(workbook.Sheets[sheetName] ?? XLSX.utils.book_new()),
                );
              }
            });
            host.append(tabs, tables);
            return;
          }
          if (isPresentationMime(props.mimeType)) {
            const { init } = await import('pptx-preview');
            if (disposed) return;
            host.classList.add('rich-pptx');
            const previewer = init(host, {
              width: Math.round(host.clientWidth || 900),
              height: Math.round((host.clientWidth || 900) * 0.5625),
              mode: 'list',
            });
            await previewer.preview(buffer);
            if (disposed) return;
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
