import { createMemo, createSignal, type JSX, onCleanup } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { PrintManager } from '@/features/printing/print-manager';
import type { VaccinationCalendar } from '@/features/vaccination/vaccination-calendar';
import {
  renderVaccinationPrintHtml,
  VACCINATION_PRINT_TITLE,
} from '@/features/vaccination/vaccination-print';

/** A4 landscape at 96 dpi: the print is laid out on this sheet and scaled to the screen. */
const SHEET_WIDTH_PX = 1123;
const SHEET_HEIGHT_PX = 794;

/** The whole calendar as it will print, with the print / save-as-PDF action. */
export function VaccinationPrintDialog(props: {
  readonly open: boolean;
  readonly calendar: VaccinationCalendar;
  readonly printedOn: string;
  readonly onClose: () => void;
}): JSX.Element {
  const [scale, setScale] = createSignal(1);
  const [sheetHeight, setSheetHeight] = createSignal(SHEET_HEIGHT_PX);
  const watchWidth = (host: HTMLElement): void => {
    const update = (): void => {
      setScale(Math.min(1, host.clientWidth / SHEET_WIDTH_PX));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  };
  const html = createMemo(() => renderVaccinationPrintHtml(props.calendar, props.printedOn));
  const print = (): void => {
    if (!PrintManager.html(html(), VACCINATION_PRINT_TITLE)) {
      toast.error('Не удалось открыть печать. Разрешите всплывающие окна для этого сайта.');
    }
  };
  return (
    <OverlayDialog
      open={props.open}
      title="Календарь прививок"
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
      <p class="vax-preview__note">
        Печатаются все три приложения приказа целиком, как в оригинале: таблицы, примечания, сноски
        и редакция приказа. Сводка по возрасту помечена как составленная.
      </p>
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
            title="Предпросмотр печати календаря прививок"
            sandbox="allow-same-origin"
            srcdoc={html()}
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
