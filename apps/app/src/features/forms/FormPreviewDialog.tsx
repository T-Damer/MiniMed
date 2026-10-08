import type { FormSchema } from '@localmed/contracts';
import { createMemo, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { formPrintTitle, renderFormPrintHtml } from '@/features/forms/form-print';
import { A4_LONG_PX, A4_SHORT_PX } from '@/features/forms/form-sheet';
import type { FormValues } from '@/features/forms/form-values';
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
  const [scale, setScale] = createSignal(1);
  const [sheetHeight, setSheetHeight] = createSignal(sheetMinHeightPx());
  const watchWidth = (host: HTMLElement): void => {
    const update = (): void => {
      setScale(Math.min(1, host.clientWidth / sheetWidthPx()));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  };
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
      <div class="form-preview__viewport" ref={watchWidth}>
        <div
          class="form-preview__sheet"
          style={{ width: `${sheetWidthPx() * scale()}px`, height: `${sheetHeight() * scale()}px` }}
        >
          {/* Same-origin, no scripts: the page is built from escaped values and is only measured. */}
          <iframe
            class="form-preview__frame"
            title="Предпросмотр бланка"
            sandbox="allow-same-origin"
            srcdoc={html()}
            style={{
              width: `${sheetWidthPx()}px`,
              height: `${sheetHeight()}px`,
              transform: `scale(${scale()})`,
            }}
            onLoad={(event) => {
              const height = event.currentTarget.contentDocument?.documentElement.scrollHeight;
              if (height) setSheetHeight(Math.max(height, sheetMinHeightPx()));
            }}
          />
        </div>
      </div>
    </OverlayDialog>
  );
}
