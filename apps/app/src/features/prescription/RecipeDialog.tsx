import { createSignal, type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { PrintManager } from '@/features/printing/print-manager';
import { isAndroidNativeShareAvailable, nativeAndroidShareText } from '@/state/native-share';
import { RECIPE_PRINT_TITLE, renderRecipePrintHtml } from './recipe-print';
import '@/styles/prescription.css';

/**
 * «Рецепт»: the prescription as text, ready to copy, share or print. The text is the one the blank
 * is filled from; the doctor edits it in the tool, not here.
 */
export function RecipeDialog(props: {
  readonly open: boolean;
  readonly text: string;
  /** What to show while nothing is prescribed yet. */
  readonly empty?: JSX.Element;
  readonly onClose: () => void;
  readonly children?: JSX.Element;
}): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  const hasText = (): boolean => /Rp\./u.test(props.text);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Не удалось скопировать. Выделите текст и скопируйте вручную.');
    }
  };
  const share = async (): Promise<void> => {
    try {
      if (isAndroidNativeShareAvailable())
        await nativeAndroidShareText(RECIPE_PRINT_TITLE, props.text);
      else if (typeof navigator.share === 'function') {
        await navigator.share({ title: RECIPE_PRINT_TITLE, text: props.text });
      } else await copy();
    } catch (cause) {
      // Closing the share sheet is not an error.
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        toast.error('Не удалось поделиться текстом.');
      }
    }
  };
  const print = (): void => {
    if (!PrintManager.html(renderRecipePrintHtml(props.text), RECIPE_PRINT_TITLE)) {
      toast.error('Не удалось открыть печать. Разрешите всплывающие окна для этого сайта.');
    }
  };
  return (
    <OverlayDialog
      open={props.open}
      title="Рецепт"
      class="recipe-dialog"
      bodyClass="recipe-dialog__body"
      onClose={props.onClose}
      headerEnd={
        <Show when={hasText()}>
          <span class="recipe-dialog__tools">
            <Button
              type="button"
              variant="icon"
              aria-label={copied() ? 'Скопировано' : 'Копировать'}
              title="Копировать"
              icon={<AppGlyph name={copied() ? 'check' : 'copy'} />}
              onClick={() => void copy()}
            />
            <Button
              type="button"
              variant="icon"
              aria-label="Поделиться"
              title="Поделиться"
              icon={<AppGlyph name="share" />}
              onClick={() => void share()}
            />
            <Button
              type="button"
              variant="icon"
              aria-label="Печать"
              title="Печать"
              icon={<AppGlyph name="printer" />}
              onClick={print}
            />
          </span>
        </Show>
      }
    >
      {props.children}
      <Show
        when={hasText()}
        fallback={
          <div class="recipe-dialog__empty">{props.empty ?? 'Назначение пока пустое.'}</div>
        }
      >
        <pre class="recipe-dialog__text" data-testid="recipe-text">
          {props.text}
        </pre>
      </Show>
    </OverlayDialog>
  );
}
