import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import {
  AppContextMenu,
  type AppContextMenuAction,
  requestContextMenu,
} from '@/components/AppContextMenu';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { A4_LONG_PX, A4_SHORT_PX } from '@/features/forms/form-sheet';
import { PaperPreview } from '@/features/printing/PaperPreview';
import { PrintManager } from '@/features/printing/print-manager';
import { isAndroidNativeShareAvailable, nativeAndroidShareText } from '@/state/native-share';
import { RECIPE_PRINT_TITLE, renderRecipePrintHtml } from './recipe-print';
import '@/styles/prescription.css';

/**
 * «Рецепт»: the prescription text with a static paper-preview thumbnail in the header (clicking it
 * zooms into the full real A4 `PaperPreview`) and a single Print button whose menu holds Print,
 * Share, and Copy.
 */
export function RecipeDialog(props: {
  readonly open: boolean;
  readonly text: string;
  /** What to show while nothing is prescribed yet. */
  readonly empty?: JSX.Element;
  readonly headerAction?: JSX.Element;
  readonly onClose: () => void;
  readonly children?: JSX.Element;
}): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const hasText = (): boolean => /Rp\.?/iu.test(props.text);

  // Only render the full print HTML when the zoomed preview dialog is actually opened (or printed).
  const previewHtml = createMemo<string>(
    (previous) => (previewOpen() && hasText() ? renderRecipePrintHtml(props.text) : previous),
    '',
  );

  // Compact static preview lines for the tiny header paper thumbnail (no iframe re-renders).
  const thumbLines = createMemo(() =>
    props.text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 7),
  );

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      toast.success('Рецепт скопирован.');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Не удалось скопировать. Выделите текст и скопируйте вручную.');
    }
  };

  const share = async (): Promise<void> => {
    try {
      if (isAndroidNativeShareAvailable()) {
        await nativeAndroidShareText(RECIPE_PRINT_TITLE, props.text);
      } else if (typeof navigator.share === 'function') {
        await navigator.share({ title: RECIPE_PRINT_TITLE, text: props.text });
      } else {
        await copy();
      }
    } catch (cause) {
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

  const printMenuActions = (): readonly AppContextMenuAction[] => [
    {
      id: 'print',
      label: 'Печать / PDF',
      icon: 'printer',
      onSelect: print,
    },
    {
      id: 'share',
      label: 'Поделиться',
      icon: 'share',
      onSelect: () => void share(),
    },
    {
      id: 'copy',
      label: copied() ? 'Скопировано' : 'Копировать текст',
      icon: copied() ? 'check' : 'copy',
      onSelect: () => void copy(),
    },
  ];

  return (
    <>
      <OverlayDialog
        open={props.open}
        title="Рецепт"
        class="recipe-dialog"
        bodyClass="recipe-dialog__body"
        onClose={props.onClose}
        headerEnd={
          <span class="recipe-dialog__tools">
            {props.headerAction}
            <Show when={hasText()}>
              <button
                type="button"
                class="recipe-thumb"
                aria-label="Предпросмотр рецепта"
                title="Открыть предпросмотр рецепта"
                onClick={() => setPreviewOpen(true)}
              >
                <span class="recipe-thumb__paper" aria-hidden="true">
                  <For each={thumbLines()}>
                    {(line) => <span class="recipe-thumb__line">{line}</span>}
                  </For>
                </span>
              </button>
            </Show>
            <AppContextMenu
              class="recipe-dialog__print-menu"
              actions={printMenuActions()}
              hideButton
            >
              <Button
                type="button"
                variant="icon"
                aria-label="Печать и отправка"
                title="Печать, поделиться или скопировать"
                disabled={!hasText()}
                icon={<AppGlyph name="printer" />}
                onClick={requestContextMenu}
              />
            </AppContextMenu>
          </span>
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

      <OverlayDialog
        open={previewOpen()}
        title="Предпросмотр рецепта"
        presentation="screen"
        class="form-preview"
        bodyClass="form-preview__body"
        onClose={() => setPreviewOpen(false)}
        headerEnd={
          <span class="recipe-dialog__tools">
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
              title="Печать или сохранить в PDF"
              icon={<AppGlyph name="printer" />}
              onClick={print}
            />
          </span>
        }
      >
        <Show when={previewHtml()}>
          {(html) => (
            <PaperPreview
              title="Предпросмотр рецепта"
              html={html()}
              sheetWidth={A4_SHORT_PX}
              sheetMinHeight={A4_LONG_PX}
            />
          )}
        </Show>
      </OverlayDialog>
    </>
  );
}
