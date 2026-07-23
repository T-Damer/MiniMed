import { createEffect, type JSX, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

interface OverlayDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly subtitle?: string;
  readonly labelledBy?: string;
  readonly class?: string;
  readonly onClose: () => void;
  readonly children: JSX.Element;
}

export function OverlayDialog(props: OverlayDialogProps): JSX.Element {
  let panel: HTMLElement | undefined;

  createEffect(() => {
    if (!props.open) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    queueMicrotask(() => panel?.focus());
    onCleanup(() => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    });
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="overlay-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) props.onClose();
          }}
        >
          <section
            ref={(element) => {
              panel = element;
            }}
            class={`overlay-dialog ${props.class ?? ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={props.labelledBy ?? 'overlay-dialog-title'}
            tabindex={-1}
          >
            <header class="overlay-dialog-header">
              <div>
                <h2 id={props.labelledBy ?? 'overlay-dialog-title'}>{props.title}</h2>
                <Show when={props.subtitle}>{(subtitle) => <p>{subtitle()}</p>}</Show>
              </div>
              <button type="button" aria-label="Закрыть" onClick={props.onClose}>
                ×
              </button>
            </header>
            <div class="overlay-dialog-body">{props.children}</div>
          </section>
        </div>
      </Portal>
    </Show>
  );
}
