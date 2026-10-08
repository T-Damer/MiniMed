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

/**
 * A print page as it will come out of the printer: fitted to the screen width, then zoomed by a
 * two-finger pinch, a double tap, Ctrl+wheel or the +/− buttons, and panned by scrolling. The
 * frame never takes pointer events, so every gesture reaches the surface around it.
 */
export function PaperPreview(props: PaperPreviewProps): JSX.Element {
  const [fit, setFit] = createSignal(1);
  const [sheetHeight, setSheetHeight] = createSignal(props.sheetMinHeight);
  const pinch = usePinchZoom({ expandScrollPort: true, doubleTapZoom: true, wheelZoom: 'ctrl' });
  const watchWidth = (host: HTMLElement): void => {
    const update = (): void => {
      setFit(Math.max(MIN_FIT_SCALE, Math.min(1, host.clientWidth / props.sheetWidth)));
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
                const height = event.currentTarget.contentDocument?.documentElement.scrollHeight;
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
