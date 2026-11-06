import { createSignal, type JSX, onCleanup } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { PinchZoomSurface } from '@/features/library/PinchZoomSurface';
import { usePinchZoom } from '@/features/library/use-pinch-zoom';

import '@/features/printing/paper-preview.css';

/** A phone is narrower than the sheet several times over; below this the page is not worth drawing. */
const MIN_FIT_SCALE = 0.2;

export interface PaperPreviewProps {
  /** Accessible name of the preview frame. */
  readonly title: string;
  /** The complete HTML document; it is built from escaped data and only measured here. */
  readonly html: string;
  /** Natural width of the sheet in CSS pixels. */
  readonly sheetWidth: number;
  /** Natural height of one sheet; the page is taller when its content is. */
  readonly sheetMinHeight: number;
}

const PAGE_BREAK_VALUES = new Set(['page', 'always', 'left', 'right', 'recto', 'verso']);

/**
 * The preview is one long sheet, but the printer starts a new page wherever the document asks for
 * one (`break-before: page`, the back of form 107-1/у): a gap with the page number is drawn there,
 * so the preview shows the same pages as the printout (Haiku print audit 2026-11-06).
 */
function markPageBreaks(document: Document): void {
  const view = document.defaultView;
  if (!view) return;
  let page = 1;
  for (const element of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
    if (element.dataset['previewPageBreak']) continue;
    const style = view.getComputedStyle(element);
    const before =
      PAGE_BREAK_VALUES.has(style.breakBefore) || PAGE_BREAK_VALUES.has(style.pageBreakBefore);
    if (!before || element === document.body.firstElementChild) continue;
    page += 1;
    const gap = document.createElement('div');
    gap.dataset['previewPageBreak'] = 'true';
    gap.setAttribute('aria-hidden', 'true');
    gap.textContent = `Страница ${String(page)}`;
    gap.setAttribute(
      'style',
      'margin:6mm 0;padding:2mm 0;border-block:1px dashed #9a9384;background:#e9e4d8;color:#6b6457;font:600 9pt system-ui,sans-serif;text-align:center;break-before:avoid;',
    );
    element.before(gap);
  }
}

/**
 * A print page as it will come out of the printer: fitted to the screen width, then zoomed by a
 * two-finger pinch, a double tap, Ctrl+wheel or the +/− buttons, and panned by scrolling. The
 * frame never takes pointer events, so every gesture reaches the surface around it.
 */
export function PaperPreview(props: PaperPreviewProps): JSX.Element {
  const [hostWidth, setHostWidth] = createSignal(0);
  // Follows the sheet too: turning the page (portrait ↔ landscape) refits it to the screen.
  const fit = (): number =>
    hostWidth() > 0 ? Math.max(MIN_FIT_SCALE, Math.min(1, hostWidth() / props.sheetWidth)) : 1;
  const [sheetHeight, setSheetHeight] = createSignal(props.sheetMinHeight);
  const pinch = usePinchZoom({ expandScrollPort: true, doubleTapZoom: true, wheelZoom: 'ctrl' });
  const watchWidth = (host: HTMLElement): void => {
    const update = (): void => {
      setHostWidth(host.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  };
  return (
    <div class="paper-preview">
      <div class="paper-preview__viewport" ref={watchWidth}>
        <PinchZoomSurface
          expandScrollPort
          pinch={pinch}
          class="paper-preview__surface"
          contentClass="paper-preview__content"
        >
          <div
            class="paper-preview__sheet"
            style={{
              width: `${props.sheetWidth * fit()}px`,
              height: `${sheetHeight() * fit()}px`,
            }}
          >
            {/* Same-origin, no scripts: the page is built from escaped data and is only measured. */}
            <iframe
              class="paper-preview__frame"
              title={props.title}
              sandbox="allow-same-origin"
              srcdoc={props.html}
              style={{
                width: `${props.sheetWidth}px`,
                height: `${sheetHeight()}px`,
                transform: `scale(${fit()})`,
              }}
              onLoad={(event) => {
                const frameDocument = event.currentTarget.contentDocument;
                if (frameDocument) markPageBreaks(frameDocument);
                const height = frameDocument?.documentElement.scrollHeight;
                if (height) setSheetHeight(Math.max(height, props.sheetMinHeight));
              }}
            />
          </div>
        </PinchZoomSurface>
      </div>
      <div class="paper-preview__zoom">
        <Button
          type="button"
          variant="icon"
          class="paper-preview__zoom-button"
          aria-label="Уменьшить"
          title="Уменьшить"
          disabled={pinch.scale() <= 1}
          icon={<AppGlyph name="minus" />}
          onClick={pinch.zoomOut}
        />
        <Button
          type="button"
          variant="icon"
          class="paper-preview__zoom-button"
          aria-label="Увеличить"
          title="Увеличить"
          icon={<AppGlyph name="plus" />}
          onClick={pinch.zoomIn}
        />
      </div>
    </div>
  );
}
