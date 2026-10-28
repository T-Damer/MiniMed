import { createUniqueId, type JSX } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';

import '@/components/ConfirmationDialog.css';

interface ConfirmationDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: JSX.Element;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly danger?: boolean;
  /** The confirm button's icon when the default (trash when `danger`) does not fit the action. */
  readonly icon?: AppGlyphName;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * A question that needs an explicit answer, on the same paper sheet as every other dialog:
 * pulling it down, Escape or the scrim mean «Отмена».
 */
export function ConfirmationDialog(props: ConfirmationDialogProps): JSX.Element {
  const descriptionId = createUniqueId();
  const cancel = (): void => props.onOpenChange(false);
  return (
    <OverlayDialog
      open={props.open}
      title={props.title}
      role="alertdialog"
      describedBy={descriptionId}
      class="confirmation-sheet"
      onClose={cancel}
    >
      <div class="confirmation-sheet__description" id={descriptionId}>
        {props.description}
      </div>
      <div class="confirmation-sheet__actions">
        <button type="button" class="confirmation-sheet__button" onClick={cancel}>
          <AppGlyph name="close" class="confirmation-sheet__icon" />
          {props.cancelLabel ?? 'Отмена'}
        </button>
        <button
          type="button"
          class="confirmation-sheet__button confirmation-sheet__button--confirm"
          classList={{ 'confirmation-sheet__button--danger': Boolean(props.danger) }}
          onClick={props.onConfirm}
        >
          <AppGlyph
            name={props.icon ?? (props.danger ? 'trash' : 'list-checks')}
            class="confirmation-sheet__icon"
          />
          {props.confirmLabel}
        </button>
      </div>
    </OverlayDialog>
  );
}
