import { createSignal, type JSX, onCleanup } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { PrintManager } from '@/features/printing/print-manager';
import {
  HANDOUT_SHEET,
  VACCINATION_HANDOUT_TITLE,
} from '@/features/vaccination/vaccination-handout-print';

const MIN_SCALE = 0.3;

/** The handout as it will print, with the print / save-as-PDF button. */
export function VaccinationPrintDialog(props: {
  readonly open: boolean;
  /** The complete HTML document; it is built from escaped data and only measured here. */
  readonly html: string;
  readonly onClose: () => void;
}): JSX.Element {
  const [scale, setScale] = createSignal(1);
  const [sheetHeight, setSheetHeight] = createSignal<number>(HANDOUT_SHEET.height);
  const watchWidth = (host: HTMLElement): void => {
    const update = (): void => {
      setScale(Math.max(MIN_SCALE, Math.min(1, host.clientWidth / HANDOUT_SHEET.width)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  };
  const print = (): void => {
    if (!PrintManager.html(props.html, VACCINATION_HANDOUT_TITLE)) {
      toast.error('Не удалось открыть печать. Разрешите всплывающие окна для этого сайта.');
    }
  };
  return (
    <OverlayDialog
      open={props.open}
      title="Лист для мамы"
      presentation="screen"
      class="vax-preview"
      bodyClass="vax-preview__body"
      onClose={props.onClose}
      headerEnd={
        <Button
          type="button"
          variant="primary"
          class="vax-preview__print"
          aria-label="Печать"
          title="Печать"
          icon={<AppGlyph name="printer" />}
          onClick={print}
        />
      }
    >
      <div class="vax-preview__viewport" ref={watchWidth}>
        <div
          class="vax-preview__sheet"
          style={{
            width: `${HANDOUT_SHEET.width * scale()}px`,
            height: `${sheetHeight() * scale()}px`,
          }}
        >
          {/* Same-origin, no scripts: the page is built from escaped data and is only measured. */}
          <iframe
            class="vax-preview__frame"
            title="Предпросмотр листа для мамы"
            sandbox="allow-same-origin"
            srcdoc={props.html}
            style={{
              width: `${HANDOUT_SHEET.width}px`,
              height: `${sheetHeight()}px`,
              transform: `scale(${scale()})`,
            }}
            onLoad={(event) => {
              const height = event.currentTarget.contentDocument?.documentElement.scrollHeight;
              if (height) setSheetHeight(Math.max(height, HANDOUT_SHEET.height));
            }}
          />
        </div>
      </div>
    </OverlayDialog>
  );
}
