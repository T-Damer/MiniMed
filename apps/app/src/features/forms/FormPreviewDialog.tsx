import type { FormSchema } from '@localmed/contracts';
import { createMemo, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { formPrintTitle, renderFormPrintHtml } from '@/features/forms/form-print';
import type { FormValues } from '@/features/forms/form-values';
import { PrintManager } from '@/features/printing/print-manager';
import { getPluralMessage } from '@/i18n/browser-i18n';

/** The blank is laid out on a 210 mm sheet and scaled down to the screen, never reflowed. */
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;

export interface FormPreviewDialogProps {
  readonly open: boolean;
  readonly schema: FormSchema;
  readonly values: FormValues;
  readonly missingCount: number;
  readonly invalidCount: number;
  readonly onClose: () => void;
}

/** The filled blank as it will print, with the print / save-as-PDF action. */
export function FormPreviewDialog(props: FormPreviewDialogProps): JSX.Element {
  const [scale, setScale] = createSignal(1);
  const [sheetHeight, setSheetHeight] = createSignal(A4_HEIGHT_PX);
  const watchWidth = (host: HTMLElement): void => {
    const update = (): void => {
      setScale(Math.min(1, host.clientWidth / A4_WIDTH_PX));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  };
  const html = createMemo(() => renderFormPrintHtml(props.schema, props.values));
  const print = (): void => {
    if (!PrintManager.html(html(), formPrintTitle(props.schema))) {
      toast.error('Не удалось открыть печать. Разрешите всплывающие окна для этого сайта.');
    }
  };
  return (
    <OverlayDialog
      open={props.open}
      title={`Форма № ${props.schema.formNumber}`}
      subtitle="Предпросмотр бланка"
      presentation="screen"
      class="form-preview"
      bodyClass="form-preview__body"
      onClose={props.onClose}
      headerEnd={
        <Button
          type="button"
          variant="primary"
          class="form-preview__print"
          icon={<AppGlyph name="printer" />}
          onClick={print}
        >
          Печать / PDF
        </Button>
      }
    >
      <Show when={props.missingCount > 0 || props.invalidCount > 0}>
        <p class="form-preview__warning" role="status">
          <Show when={props.missingCount > 0}>
            {getPluralMessage('forms_missing_required_count', props.missingCount)}
          </Show>
          <Show when={props.missingCount > 0 && props.invalidCount > 0}>{'. '}</Show>
          <Show when={props.invalidCount > 0}>Есть поля с ошибками: {props.invalidCount}</Show>. На
          бланке они останутся пустыми или с введённым значением — печать не блокируется.
        </p>
      </Show>
      <div class="form-preview__viewport" ref={watchWidth}>
        <div
          class="form-preview__sheet"
          style={{ width: `${A4_WIDTH_PX * scale()}px`, height: `${sheetHeight() * scale()}px` }}
        >
          {/* Same-origin, no scripts: the page is built from escaped values and is only measured. */}
          <iframe
            class="form-preview__frame"
            title="Предпросмотр бланка"
            sandbox="allow-same-origin"
            srcdoc={html()}
            style={{
              width: `${A4_WIDTH_PX}px`,
              height: `${sheetHeight()}px`,
              transform: `scale(${scale()})`,
            }}
            onLoad={(event) => {
              const height = event.currentTarget.contentDocument?.documentElement.scrollHeight;
              if (height) setSheetHeight(Math.max(height, A4_HEIGHT_PX));
            }}
          />
        </div>
      </div>
      <p class="form-preview__note">
        Бланк печатается для подписи и печати организации. Приложение не выдаёт юридически значимые
        электронные документы.
      </p>
    </OverlayDialog>
  );
}
