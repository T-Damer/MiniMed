import { createEffect, createSignal, type JSX, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { AppGlyph } from '@/components/AppGlyph';
import { lockBodyScroll } from '@/components/body-scroll-lock';
import { NARROW_VIEWPORT_QUERY } from '@/components/narrow-viewport';
import { sheetDragOffset, sheetDragShouldClose } from '@/components/sheet-drag';
import { setDarkHeaderStatusBar } from '@/state/native-system-ui';

import '@/components/overlay-sheet.css';

interface OverlayDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly subtitle?: string;
  readonly labelledBy?: string;
  readonly class?: string;
  readonly bodyClass?: string;
  readonly headerClass?: string;
  /** When false, the dialog does not push a browser history entry (document overlays manage URL elsewhere). */
  readonly tracksHistory?: boolean;
  /** When false, the dialog has no close button and ignores Escape and backdrop taps. */
  readonly dismissible?: boolean;
  /**
   * `sheet` (default): a paper sheet — from the bottom edge on phones, centred on wide screens —
   * that can be pulled down to close. `screen`: viewers and editors that need the whole screen.
   */
  readonly presentation?: 'sheet' | 'screen';
  /** `alertdialog` for a confirmation that needs an explicit answer. */
  readonly role?: 'dialog' | 'alertdialog';
  /** Id of the element that describes the dialog, for assistive tech. */
  readonly describedBy?: string;
  readonly headerStart?: JSX.Element;
  readonly headerEnd?: JSX.Element;
  readonly onClose: () => void;
  readonly children: JSX.Element;
}

let nextOverlayDialogId = 0;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusableElementsWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

export function OverlayDialog(props: OverlayDialogProps): JSX.Element {
  let panel: HTMLElement | undefined;
  let historyEntryPushed = false;
  const titleId = props.labelledBy ?? `overlay-dialog-title-${++nextOverlayDialogId}`;
  const tracksHistory = () => props.tracksHistory !== false;
  const dismissible = () => props.dismissible !== false;
  const presentation = () => props.presentation ?? 'sheet';
  const [dragOffset, setDragOffset] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);
  let drag:
    | { readonly startY: number; readonly startTime: number; readonly id: number }
    | undefined;

  const closeDialog = (): void => {
    if (historyEntryPushed) {
      historyEntryPushed = false;
      window.history.back();
      return;
    }
    props.onClose();
  };

  // Pull-to-close: only a dismissible sheet at phone width, and never from a control in the header.
  const startDrag = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0) return;
    if (presentation() !== 'sheet' || !dismissible()) return;
    if (!window.matchMedia(NARROW_VIEWPORT_QUERY).matches) return;
    if (
      event.target instanceof Element &&
      event.target.closest('button, a, input, select, textarea')
    )
      return;
    drag = { startY: event.clientY, startTime: event.timeStamp, id: event.pointerId };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const moveDrag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.id) return;
    setDragOffset(sheetDragOffset(drag.startY, event.clientY));
  };
  const endDrag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.id) return;
    const offset = sheetDragOffset(drag.startY, event.clientY);
    const close = sheetDragShouldClose(offset, event.timeStamp - drag.startTime);
    drag = undefined;
    setDragging(false);
    setDragOffset(0);
    if (event.type !== 'pointercancel' && close) closeDialog();
  };
  const dragHandlers = {
    onPointerDown: startDrag,
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  const isTopmostDialog = (): boolean => {
    const dialogs = document.querySelectorAll<HTMLElement>('.overlay-dialog');
    return dialogs.item(dialogs.length - 1) === panel;
  };

  createEffect(() => {
    if (!props.open) return;
    const restoreUrl = window.location.href;
    const restoreState = window.history.state;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (tracksHistory()) {
      window.history.pushState(
        { ...(window.history.state as object | null), overlay: true },
        '',
        restoreUrl,
      );
      historyEntryPushed = true;
    }
    setDarkHeaderStatusBar(true);
    const releaseScroll = lockBodyScroll();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!isTopmostDialog()) return;
      if (event.key === 'Escape') {
        // Only a media viewer layered over THIS dialog consumes Escape (zoom reset);
        // unrelated viewers elsewhere must not disable closing this dialog.
        if (panel?.querySelector('.media-viewer') || !dismissible()) return;
        closeDialog();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      // aria-modal="true" promises assistive tech that background content is inert,
      // so keyboard focus has to cycle inside the panel instead of leaking behind it.
      const focusable = focusableElementsWithin(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (
          active === first ||
          active === panel ||
          !(active instanceof Node && panel.contains(active))
        ) {
          event.preventDefault();
          last?.focus();
        }
        return;
      }
      if (active === last || !(active instanceof Node && panel.contains(active))) {
        event.preventDefault();
        first?.focus();
      }
    };
    const handlePopState = (): void => {
      if (!isTopmostDialog() || !dismissible()) return;
      historyEntryPushed = false;
      props.onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);
    queueMicrotask(() => panel?.focus());
    onCleanup(() => {
      drag = undefined;
      setDragging(false);
      setDragOffset(0);
      setDarkHeaderStatusBar(false);
      releaseScroll();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
      if (historyEntryPushed && window.location.href === restoreUrl) {
        window.history.replaceState(restoreState, '', restoreUrl);
        historyEntryPushed = false;
      }
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    });
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class={`overlay-backdrop overlay-backdrop--${presentation()}`}
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && dismissible()) closeDialog();
          }}
        >
          {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is always dialog or alertdialog, and both take aria-modal. */}
          <section
            ref={(element) => {
              panel = element;
            }}
            class={`overlay-dialog overlay-dialog--${presentation()} ${props.class ?? ''}`}
            classList={{ 'overlay-dialog--dragging': dragging() }}
            style={dragOffset() > 0 ? { '--sheet-drag': `${dragOffset()}px` } : undefined}
            role={props.role ?? 'dialog'}
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={props.describedBy}
            tabindex={-1}
          >
            <Show when={presentation() === 'sheet' && dismissible()}>
              <div class="overlay-dialog__grip" aria-hidden="true" {...dragHandlers}>
                <span class="overlay-dialog__grip-bar" />
              </div>
            </Show>
            <header
              class={`overlay-dialog-header overlay-dialog-header--${presentation()} ${props.headerClass ?? ''}`}
              {...(presentation() === 'sheet' ? dragHandlers : {})}
            >
              {props.headerStart}
              <div class="overlay-dialog-title">
                <h2 class="overlay-dialog__heading" id={titleId}>
                  {props.title}
                </h2>
                <Show when={props.subtitle}>
                  {(subtitle) => (
                    <p
                      class={`overlay-dialog__subtitle overlay-dialog__subtitle--${presentation()}`}
                    >
                      {subtitle()}
                    </p>
                  )}
                </Show>
              </div>
              {props.headerEnd}
              <Show when={dismissible()}>
                <button
                  type="button"
                  class={`overlay-dialog__close-button overlay-dialog__close-button--${presentation()}`}
                  aria-label="Закрыть"
                  title="Закрыть"
                  onClick={closeDialog}
                >
                  <AppGlyph name="close" class="overlay-dialog__button-icon" />
                </button>
              </Show>
            </header>
            <div
              class={`overlay-dialog-body overlay-dialog-body--${presentation()} ${props.bodyClass ?? ''}`}
            >
              {props.children}
            </div>
          </section>
        </div>
      </Portal>
    </Show>
  );
}
