import type { JSX } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { PaperPreview } from '@/features/printing/PaperPreview';
import { PrintManager } from '@/features/printing/print-manager';
import {
  HANDOUT_SHEET,
  VACCINATION_HANDOUT_TITLE,
} from '@/features/vaccination/vaccination-handout-print';

/** The handout as it will print, with the print / save-as-PDF button. */
export function VaccinationPrintDialog(props: {
  readonly open: boolean;
  /** The complete HTML document; it is built from escaped data and only measured here. */
  readonly html: string;
  readonly onClose: () => void;
}): JSX.Element {
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
      <PaperPreview
        title="Предпросмотр листа для мамы"
        html={props.html}
        sheetWidth={HANDOUT_SHEET.width}
        sheetMinHeight={HANDOUT_SHEET.height}
      />
    </OverlayDialog>
  );
}
