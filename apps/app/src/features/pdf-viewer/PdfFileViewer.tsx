import { createEffect, createSignal, type JSX, on, Show } from 'solid-js';
import { toast } from 'solid-sonner';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { DocumentFindBar } from '@/features/library/DocumentFindBar';
import { PdfViewer } from '@/features/pdf-viewer/PdfViewer';
import { openPdfInSystem, printPdf } from '@/features/pdf-viewer/pdf-actions';
import { createPdfViewerModel } from '@/features/pdf-viewer/pdf-viewer-model';

export interface PdfFileViewerProps {
  readonly blob: Blob;
  readonly title: string;
  /** Remember where the reader stopped under this id (`note:<id>`); omit to start at page 1. */
  readonly resumeKey?: string;
}

/**
 * The shared PDF viewer with its own toolbar (find, thumbnails, print, open in the system) for
 * places that show a PDF in a dialog rather than as a reader page.
 */
export function PdfFileViewer(props: PdfFileViewerProps): JSX.Element {
  const model = createPdfViewerModel({
    resumeKey: () => props.resumeKey,
  });
  const [thumbnailsOpen, setThumbnailsOpen] = createSignal(false);

  createEffect(
    on(
      () => props.blob,
      (blob) => void model.load(blob),
    ),
  );

  const print = (): void => {
    void printPdf(props.blob, props.title)
      .then((printed) => {
        if (!printed) toast.error('Не удалось открыть окно печати.');
      })
      .catch(() => toast.error('Не удалось открыть окно печати.'));
  };
  const openExternally = (): void => {
    void openPdfInSystem(props.blob, props.title)
      .then((opened) => {
        if (!opened) toast.error('Не удалось открыть файл в системе.');
      })
      .catch(() => toast.error('Не удалось открыть файл в системе.'));
  };

  return (
    <div class="pdf-file-viewer">
      <div class="pdf-file-viewer__toolbar" role="toolbar" aria-label="Инструменты PDF">
        <Button
          type="button"
          variant="icon"
          class="pdf-file-viewer__tool"
          aria-label="Миниатюры страниц"
          aria-pressed={thumbnailsOpen()}
          disabled={model.pageCount() === 0}
          onClick={() => setThumbnailsOpen((open) => !open)}
          icon={<AppGlyph name="squares-four" class="pdf-file-viewer__icon" />}
        />
        <DocumentFindBar
          class="pdf-file-viewer__find"
          closable
          units={model.findUnits}
          busy={model.findBusy}
          disabled={model.pageCount() === 0}
          onOpenChange={(open) => {
            if (open) model.beginFind();
          }}
          onResult={model.setFindState}
        />
        <span class="pdf-file-viewer__spacer" />
        <Button
          type="button"
          variant="icon"
          class="pdf-file-viewer__tool"
          aria-label="Печать"
          disabled={model.pageCount() === 0}
          onClick={print}
          icon={<AppGlyph name="printer" class="pdf-file-viewer__icon" />}
        />
        <Button
          type="button"
          variant="icon"
          class="pdf-file-viewer__tool"
          aria-label="Открыть в системе"
          disabled={model.pageCount() === 0}
          onClick={openExternally}
          icon={<AppGlyph name="arrow-square-out" class="pdf-file-viewer__icon" />}
        />
      </div>
      <Show when={model.error()}>
        {(message) => <p class="pdf-file-viewer__error">{message()}</p>}
      </Show>
      <PdfViewer
        model={model}
        contained
        thumbnailRail
        thumbnailsOpen={thumbnailsOpen()}
        onThumbnailSelected={() => {
          if (window.matchMedia('(max-width: 640px)').matches) setThumbnailsOpen(false);
        }}
        pageId={(pageIndex) => `pdf-file-page-${String(pageIndex)}`}
        onPageError={(cause) =>
          toast.error(
            cause instanceof Error ? cause.message : 'Не удалось отобразить страницу PDF.',
          )
        }
      />
    </div>
  );
}

export default PdfFileViewer;
