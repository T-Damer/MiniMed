import { createEffect, type JSX, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { lockBodyScroll } from '@/components/body-scroll-lock';

interface OverlayDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly subtitle?: string;
  readonly labelledBy?: string;
  readonly class?: string;
  readonly headerStart?: JSX.Element;
  readonly onClose: () => void;
  readonly children: JSX.Element;
}

export function OverlayDialog(props: OverlayDialogProps): JSX.Element {
  let panel: HTMLElement | undefined;

  createEffect(() => {
    if (!props.open) return;
    const releaseScroll = lockBodyScroll();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    queueMicrotask(() => panel?.focus());
    onCleanup(() => {
      releaseScroll();
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
              {props.headerStart}
              <div class="overlay-dialog-title">
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
