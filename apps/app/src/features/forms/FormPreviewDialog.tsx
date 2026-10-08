import type { FormSchema } from '@localmed/contracts';
import { createMemo, type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { formPrintTitle, renderFormPrintHtml } from '@/features/forms/form-print';
import { A4_LONG_PX, A4_SHORT_PX } from '@/features/forms/form-sheet';
import type { FormValues } from '@/features/forms/form-values';
import { PaperPreview } from '@/features/printing/PaperPreview';
import { PrintManager } from '@/features/printing/print-manager';
import { getPluralMessage } from '@/i18n/browser-i18n';

export interface FormPreviewDialogProps {
  readonly open: boolean;
  readonly schema: FormSchema;
  readonly values: FormValues;
  readonly missingCount: number;
  readonly invalidCount: number;
  readonly onClose: () => void;
}

/** The filled blank as it will print, with a printer button for print / save-as-PDF. */
export function FormPreviewDialog(props: FormPreviewDialogProps): JSX.Element {
  const landscape = (): boolean => props.schema.layout.page.orientation === 'landscape';
  const sheetWidthPx = (): number => (landscape() ? A4_LONG_PX : A4_SHORT_PX);
  const sheetMinHeightPx = (): number => (landscape() ? A4_SHORT_PX : A4_LONG_PX);
  // The page is laid out only while the dialog is open (the last page stays for its exit).
  const html = createMemo<string>(
    (previous) => (props.open ? renderFormPrintHtml(props.schema, props.values) : previous),
    '',
  );
  const print = (): void => {
    if (!PrintManager.html(html(), formPrintTitle(props.schema))) {
      toast.error('Не удалось открыть печать. Разрешите всплывающие окна для этого сайта.');
    }
  };
  return (
    <OverlayDialog
      open={props.open}
      title={`Форма № ${props.schema.formNumber}`}
      presentation="screen"
      class="form-preview"
      bodyClass="form-preview__body"
      onClose={props.onClose}
      headerEnd={
        <Button
          type="button"
          variant="icon"
          class="form-preview__print"
          aria-label="Печать"
          title="Печать или сохранить в PDF"
          icon={<AppGlyph name="printer" />}
          onClick={print}
        />
      }
    >
      <Show when={props.missingCount > 0 || props.invalidCount > 0}>
        <p class="form-preview__warning" role="status">
          <AppGlyph name="info" class="form-preview__warning-icon" />
          <span>
            <Show when={props.missingCount > 0}>
              {getPluralMessage('forms_missing_required_count', props.missingCount)}
            </Show>
            <Show when={props.missingCount > 0 && props.invalidCount > 0}>{' · '}</Show>
            <Show when={props.invalidCount > 0}>Ошибок в полях: {props.invalidCount}</Show>
          </span>
        </p>
      </Show>
      <PaperPreview
        title="Предпросмотр бланка"
        html={html()}
        sheetWidth={sheetWidthPx()}
        sheetMinHeight={sheetMinHeightPx()}
      />
    </OverlayDialog>
  );
}
