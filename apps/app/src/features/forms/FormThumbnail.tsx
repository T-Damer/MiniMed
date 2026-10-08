import type { FormSchema } from '@localmed/contracts';
import { createMemo, createSignal, type JSX, onCleanup } from 'solid-js';

import { createDebouncedValue } from '@/components/debounced-value';
import { renderFormPrintHtml } from '@/features/forms/form-print';
import { A4_LONG_PX, A4_SHORT_PX } from '@/features/forms/form-sheet';
import type { FormValues } from '@/features/forms/form-values';

/** The thumbnail redraws once typing has paused for this long. */
export const FORM_THUMBNAIL_DEBOUNCE_MS = 350;

export interface FormThumbnailProps {
  readonly schema: FormSchema;
  readonly values: FormValues;
  readonly onOpen: () => void;
}

/**
 * The first sheet of the blank — the real print rendering, scaled down — as a small paper in the
 * header. It follows the values while they are typed (debounced) and opens the full preview.
 */
export function FormThumbnail(props: FormThumbnailProps): JSX.Element {
  const landscape = (): boolean => props.schema.layout.page.orientation === 'landscape';
  const sheetWidthPx = (): number => (landscape() ? A4_LONG_PX : A4_SHORT_PX);
  const sheetHeightPx = (): number => (landscape() ? A4_SHORT_PX : A4_LONG_PX);
  const [scale, setScale] = createSignal(0.05);
  const watchWidth = (host: HTMLElement): void => {
    const update = (): void => {
      if (host.clientWidth > 0) setScale(host.clientWidth / sheetWidthPx());
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    onCleanup(() => observer.disconnect());
  };
  const settledValues = createDebouncedValue(() => props.values, FORM_THUMBNAIL_DEBOUNCE_MS);
  const html = createMemo(() => renderFormPrintHtml(props.schema, settledValues()));
  return (
    <button
      type="button"
      class="form-thumbnail"
      classList={{ 'form-thumbnail--landscape': landscape() }}
      aria-label="Предпросмотр и печать"
      title="Предпросмотр и печать"
      onClick={props.onOpen}
    >
      <span class="form-thumbnail__paper" ref={watchWidth}>
        {/* Same-origin, no scripts: the page is built from escaped values and is only displayed. */}
        <iframe
          class="form-thumbnail__frame"
          title="Миниатюра бланка"
          sandbox="allow-same-origin"
          tabIndex={-1}
          aria-hidden="true"
          srcdoc={html()}
          style={{
            width: `${sheetWidthPx()}px`,
            height: `${sheetHeightPx()}px`,
            transform: `scale(${scale()})`,
          }}
        />
      </span>
    </button>
  );
}
