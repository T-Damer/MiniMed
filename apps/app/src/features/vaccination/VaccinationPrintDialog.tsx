import { createSignal, type JSX, onCleanup } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { PrintManager } from '@/features/printing/print-manager';

/** A4 landscape at 96 dpi: the print is laid out on this sheet and scaled to the screen. */
const SHEET_WIDTH_PX = 1123;
const SHEET_HEIGHT_PX = 794;
const MIN_SCALE = 0.55;

/** A print document as it will print, with the print / save-as-PDF action. */
export function VaccinationPrintDialog(props: {
  readonly open: boolean;
  /** The complete HTML document; it is built from escaped data and only measured here. */
  readonly html: string;
  /** Title of the print job (the file name of a saved PDF). */
  readonly printTitle: string;
  readonly dialogTitle: string;
  readonly frameTitle: string;
  readonly note: string;
  readonly onClose: () => void;
}): JSX.Element {
  const [scale, setScale] = createSignal(1);
  const [sheetHeight, setSheetHeight] = createSignal(SHEET_HEIGHT_PX);
  const watchWidth = (host: HTMLElement): void => {
    const update = (): void => {
      // A phone shows the sheet at a readable size and lets it scroll sideways.
      setScale(Math.max(MIN_SCALE, Math.min(1, host.clientWidth / SHEET_WIDTH_PX)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  };
  const print = (): void => {
    if (!PrintManager.html(props.html, props.printTitle)) {
      toast.error('Не удалось открыть печать. Разрешите всплывающие окна для этого сайта.');
    }
  };
  return (
    <OverlayDialog
      open={props.open}
      title={props.dialogTitle}
      subtitle="Предпросмотр печати, A4 альбомная"
      presentation="screen"
      class="vax-preview"
      bodyClass="vax-preview__body"
      onClose={props.onClose}
      headerEnd={
        <Button
          type="button"
          variant="primary"
          class="vax-preview__print"
          icon={<AppGlyph name="printer" />}
          onClick={print}
        >
          Печать / PDF
        </Button>
      }
    >
      <p class="vax-preview__note">{props.note}</p>
      <div class="vax-preview__viewport" ref={watchWidth}>
        <div
          class="vax-preview__sheet"
          style={{
            width: `${SHEET_WIDTH_PX * scale()}px`,
            height: `${sheetHeight() * scale()}px`,
          }}
        >
          {/* Same-origin, no scripts: the page is built from escaped data and is only measured. */}
          <iframe
            class="vax-preview__frame"
            title={props.frameTitle}
            sandbox="allow-same-origin"
            srcdoc={props.html}
            style={{
              width: `${SHEET_WIDTH_PX}px`,
              height: `${sheetHeight()}px`,
              transform: `scale(${scale()})`,
            }}
            onLoad={(event) => {
              const height = event.currentTarget.contentDocument?.documentElement.scrollHeight;
              if (height) setSheetHeight(Math.max(height, SHEET_HEIGHT_PX));
            }}
          />
        </div>
      </div>
    </OverlayDialog>
  );
}
