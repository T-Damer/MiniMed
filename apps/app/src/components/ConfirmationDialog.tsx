import { AlertDialog } from '@kobalte/core/alert-dialog';
import type { JSX } from 'solid-js';

interface ConfirmationDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: JSX.Element;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly danger?: boolean;
  readonly onConfirm: () => void;
  readonly onOpenChange: (open: boolean) => void;
}

export function ConfirmationDialog(props: ConfirmationDialogProps): JSX.Element {
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay class="confirmation-alert-overlay" />
        <AlertDialog.Content class="confirmation-alert">
          <AlertDialog.Title>{props.title}</AlertDialog.Title>
          <AlertDialog.Description>{props.description}</AlertDialog.Description>
          <div class="confirmation-alert-actions">
            <AlertDialog.CloseButton>{props.cancelLabel ?? 'Отмена'}</AlertDialog.CloseButton>
            <button
              type="button"
              classList={{ danger: Boolean(props.danger) }}
              onClick={props.onConfirm}
            >
              {props.confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  );
}
