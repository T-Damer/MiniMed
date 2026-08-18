import { createEffect, type JSX, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { AppGlyph } from '@/components/AppGlyph';
import { lockBodyScroll } from '@/components/body-scroll-lock';

interface OverlayDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly subtitle?: string;
  readonly labelledBy?: string;
  readonly class?: string;
  readonly bodyClass?: string;
  /** When false, the dialog does not push a browser history entry (document overlays manage URL elsewhere). */
  readonly tracksHistory?: boolean;
  readonly headerStart?: JSX.Element;
  readonly headerEnd?: JSX.Element;
  readonly onClose: () => void;
  readonly children: JSX.Element;
}

let nextOverlayDialogId = 0;

export function OverlayDialog(props: OverlayDialogProps): JSX.Element {
  let panel: HTMLElement | undefined;
  let historyEntryPushed = false;
  const titleId = props.labelledBy ?? `overlay-dialog-title-${++nextOverlayDialogId}`;
  const tracksHistory = () => props.tracksHistory !== false;

  const closeDialog = (): void => {
    if (historyEntryPushed) {
      historyEntryPushed = false;
      window.history.back();
      return;
    }
    props.onClose();
  };

  const isTopmostDialog = (): boolean => {
    const dialogs = document.querySelectorAll<HTMLElement>('.overlay-dialog');
    return dialogs.item(dialogs.length - 1) === panel;
  };

  createEffect(() => {
    if (!props.open) return;
    const restoreUrl = window.location.href;
    const restoreState = window.history.state;
    if (tracksHistory()) {
      window.history.pushState(
        { ...(window.history.state as object | null), overlay: true },
        '',
        restoreUrl,
      );
      historyEntryPushed = true;
    }
    const releaseScroll = lockBodyScroll();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('.media-viewer')) return;
      closeDialog();
    };
    const handlePopState = (): void => {
      if (!isTopmostDialog()) return;
      historyEntryPushed = false;
      props.onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);
    queueMicrotask(() => panel?.focus());
    onCleanup(() => {
      releaseScroll();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
      if (historyEntryPushed && window.location.href === restoreUrl) {
        window.history.replaceState(restoreState, '', restoreUrl);
        historyEntryPushed = false;
      }
    });
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="overlay-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            ref={(element) => {
              panel = element;
            }}
            class={`overlay-dialog ${props.class ?? ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabindex={-1}
          >
            <header class="overlay-dialog-header">
              {props.headerStart}
              <div class="overlay-dialog-title">
                <h2 class="overlay-dialog__heading" id={titleId}>
                  {props.title}
                </h2>
                <Show when={props.subtitle}>
                  {(subtitle) => <p class="overlay-dialog__subtitle">{subtitle()}</p>}
                </Show>
              </div>
              {props.headerEnd}
              <button
                type="button"
                class="overlay-dialog__close-button"
                aria-label="Закрыть"
                title="Закрыть"
                onClick={closeDialog}
              >
                <AppGlyph name="close" class="overlay-dialog__button-icon" />
              </button>
            </header>
            <div class={`overlay-dialog-body ${props.bodyClass ?? ''}`}>{props.children}</div>
          </section>
        </div>
      </Portal>
    </Show>
  );
}
