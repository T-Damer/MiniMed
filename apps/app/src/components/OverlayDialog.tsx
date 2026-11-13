import {
  createEffect,
  createRenderEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { AppGlyph } from '@/components/AppGlyph';
import { lockBodyScroll } from '@/components/body-scroll-lock';
import { NavBack } from '@/components/NavBack';
import { NARROW_VIEWPORT_QUERY } from '@/components/narrow-viewport';
import { playExitGhost } from '@/components/overlay-ghost';
import { ScrollIndicator } from '@/components/ScrollIndicator';
import { SkeletonLines } from '@/components/SkeletonLines';
import { sheetDragOffset, sheetDragShouldClose } from '@/components/sheet-drag';
import { followSheetHeight } from '@/components/sheet-height';
import { type HistoryLayer, openHistoryLayer } from '@/state/history-layer';
import { motionMs } from '@/state/motion';
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
  /**
   * `back`: the close control is the app's ‹ at the start of the row, as on a page — for a
   * full-screen tool that stands in for a route (the ECG editor), so it reads like the other
   * screens (PERF6, owner 2026-11-11 «ЭКГ выглядит чужим»). `close` (default): ✕ at the end.
   */
  readonly closeAs?: 'close' | 'back';
  /**
   * What the ✕ does in words and glyph, when closing does not end anything: the recorder window
   * («Свернуть», a down caret) folds back into its floating button while the recording runs.
   */
  readonly closeControl?:
    | { readonly label: string; readonly glyph: 'close' | 'caret-down' }
    | undefined;
  readonly headerEnd?: JSX.Element;
  readonly onClose: () => void;
  readonly children: JSX.Element;
}

let nextOverlayDialogId = 0;

/** Upper bound for the exit animation at normal speed, in case it never reports finishing. */
const EXIT_FALLBACK_MS = 600;

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
  let backdrop: HTMLElement | undefined;
  let body: HTMLDivElement | undefined;
  /** The press began on the backdrop itself (not a drag out of the panel that ended there). */
  let pressedBackdrop = false;
  let historyLayer: HistoryLayer | undefined;
  const titleId = props.labelledBy ?? `overlay-dialog-title-${++nextOverlayDialogId}`;
  const tracksHistory = () => props.tracksHistory !== false;
  const dismissible = () => props.dismissible !== false;
  const presentation = () => props.presentation ?? 'sheet';
  const [dragOffset, setDragOffset] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);
  let drag:
    | { readonly startY: number; readonly startTime: number; readonly id: number }
    | undefined;
  // The dialog stays mounted after `open` turns false until its exit animation has played.
  const [mounted, setMounted] = createSignal(props.open);
  const [closing, setClosing] = createSignal(false);
  /** The exit has started and not ended: a second start would only double the waiting. */
  let exiting = false;
  /** The dialog was taken out after its exit: nothing is left to animate. */
  let ended = false;
  /** What the UI's close does once the exit has played (step the history back, tell the owner). */
  let afterExit: (() => void) | undefined;
  let exitControls:
    | { readonly settle: () => void; readonly revert: () => void; readonly end: () => void }
    | undefined;

  /**
   * Starts the exit now and unmounts once it has played. Idempotent. When the owner still wants the
   * dialog open after the exit (a close it refused), the dialog is simply shown again.
   */
  const beginExit = (): void => {
    if (exiting) {
      // The exit began at the tap and the owner has agreed since: nothing left to wait for.
      if (!props.open) exitControls?.settle();
      return;
    }
    if (!mounted()) return;
    exiting = true;
    setClosing(true);
    let done = false;
    let played = false;
    let hold: number | undefined;
    const end = (): void => {
      if (done) return;
      done = true;
      exiting = false;
      exitControls = undefined;
      afterExit = undefined;
      window.clearTimeout(fallback);
      window.clearTimeout(hold);
      ended = true;
      setMounted(false);
      setClosing(false);
      setDragOffset(0);
    };
    const revert = (): void => {
      if (done) return;
      done = true;
      exiting = false;
      exitControls = undefined;
      afterExit = undefined;
      window.clearTimeout(fallback);
      window.clearTimeout(hold);
      setClosing(false);
    };
    // Called when the exit has played and when the owner closes: ends the dialog once both are true.
    const settle = (): void => {
      if (done || !played) return;
      if (!props.open) {
        end();
        return;
      }
      // Closed from the UI but not yet by the owner (the history step is on its way): hold the
      // finished exit for a moment, then give up and show the dialog again.
      hold ??= window.setTimeout(() => {
        if (props.open) revert();
        else end();
      }, 600);
    };
    const markPlayed = (): void => {
      played = true;
      const run = afterExit;
      afterExit = undefined;
      run?.();
      settle();
    };
    exitControls = { settle, revert, end };
    const fallback = window.setTimeout(
      markPlayed,
      Math.max(EXIT_FALLBACK_MS, motionMs(EXIT_FALLBACK_MS)),
    );
    // The closing class starts the exit animations on the next style pass.
    requestAnimationFrame(() => {
      // Only the backdrop's and the panel's own exits: content may hold endless spinners.
      const animations = [...(backdrop?.getAnimations() ?? []), ...(panel?.getAnimations() ?? [])];
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(markPlayed);
    });
  };

  // A render effect, not createEffect: the views sit inside <Suspense>, and while a resource there
  // is pending user effects are held back, so an `open` change never mounted the dialog.
  createRenderEffect(
    on(
      () => props.open,
      (open) => {
        if (open) {
          // Opened again while leaving: the exit is given up and the dialog stays.
          exitControls?.revert();
          ended = false;
          setDragOffset(0);
          setClosing(false);
          setMounted(true);
          return;
        }
        beginExit();
      },
      { defer: true },
    ),
  );

  /**
   * Tells the owner the dialog is closed once its exit has played. The exit starts at once and
   * plays alone: the owner's reaction (a page that re-renders without its dialog) can block the
   * thread for many frames, which would stall an exit it lands in the middle of.
   */
  const closeAfterExit = (): void => {
    beginExit();
    if (!exiting) {
      // Nothing to play (the dialog is not on screen): the owner is told at once.
      props.onClose();
      return;
    }
    const earlier = afterExit;
    afterExit = () => {
      earlier?.();
      props.onClose();
    };
  };

  const closeDialog = (): void => {
    beginExit();
    // A dialog that is a history layer closes by stepping the history back at once (the history
    // must be where the user will find it if they navigate during the exit); the arrival tells
    // the owner after the exit.
    if (historyLayer) {
      historyLayer.pop();
      return;
    }
    // Any other dialog tells its owner at once: the owner may hold the dialog's history layer
    // itself (SheetPopover), and a layer that outlived the tap would swallow the next back.
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
    // A sheet released to close leaves from where the finger let go, not from its resting place.
    if (event.type !== 'pointercancel' && close) closeDialog();
    else setDragOffset(0);
  };
  const dragHandlers = {
    onPointerDown: startDrag,
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  const isTopmostDialog = (): boolean => {
    const dialogs = document.querySelectorAll<HTMLElement>(
      '.overlay-dialog:not(.overlay-dialog--closing)',
    );
    return dialogs.item(dialogs.length - 1) === panel;
  };

  // A sheet whose content changes height (it loads, a section opens) moves to the new height; a
  // sheet that is being pulled or is leaving takes it at once. Viewers and editors that fill the
  // screen have no height of their own to move.
  createEffect(() => {
    if (!mounted() || presentation() !== 'sheet') return;
    if (!panel || !body) return;
    onCleanup(followSheetHeight(panel, body, () => !dragging() && !closing()));
  });

  createEffect(() => {
    if (!props.open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A dialog nobody can dismiss (no close button, Escape and taps ignored) must not take back.
    if (tracksHistory() && dismissible()) {
      historyLayer = openHistoryLayer({ onPop: closeAfterExit });
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
    window.addEventListener('keydown', handleKeyDown);
    queueMicrotask(() => panel?.focus());
    onCleanup(() => {
      drag = undefined;
      setDragging(false);
      setDarkHeaderStatusBar(false);
      releaseScroll();
      window.removeEventListener('keydown', handleKeyDown);
      historyLayer?.dispose();
      historyLayer = undefined;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    });
  });

  return (
    <Show when={mounted()}>
      <Portal>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the dimmed area around the panel; Escape and the close button are the keyboard path. */}
        <div
          ref={(element) => {
            backdrop = element;
            // The owner can drop the dialog while it is open (a parent's `<Show>`, a page that
            // goes away): its exit then plays on a copy, before the portal takes the real one out.
            onCleanup(() => {
              if (ended || backdrop !== element) return;
              playExitGhost(element, motionMs(EXIT_FALLBACK_MS));
            });
          }}
          class={`overlay-backdrop overlay-backdrop--${presentation()}`}
          classList={{ 'overlay-backdrop--closing': closing() }}
          role="presentation"
          // Closes on the click, not the press: the closing backdrop stops catching pointers at once,
          // so a close on pointerdown let the same tap's click land on the page underneath.
          onPointerDown={(event) => {
            pressedBackdrop = event.target === event.currentTarget;
          }}
          onClick={(event) => {
            if (closing() || !pressedBackdrop) return;
            if (event.target === event.currentTarget && dismissible()) closeDialog();
          }}
        >
          {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is always dialog or alertdialog, and both take aria-modal. */}
          <section
            ref={(element) => {
              panel = element;
            }}
            class={`overlay-dialog overlay-dialog--${presentation()} ${props.class ?? ''}`}
            classList={{
              'overlay-dialog--dragging': dragging(),
              'overlay-dialog--closing': closing(),
            }}
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
              <Show when={props.closeAs === 'back' && dismissible()}>
                <NavBack
                  class="knowledge-back-button overlay-dialog__back-button"
                  aria-label="Назад"
                  onClick={closeDialog}
                />
              </Show>
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
              <Show when={dismissible() && props.closeAs !== 'back'}>
                <button
                  type="button"
                  class={`overlay-dialog__close-button overlay-dialog__close-button--${presentation()}`}
                  aria-label={props.closeControl?.label ?? 'Закрыть'}
                  title={props.closeControl?.label ?? 'Закрыть'}
                  onClick={closeDialog}
                >
                  <AppGlyph
                    name={props.closeControl?.glyph ?? 'close'}
                    class="overlay-dialog__button-icon"
                  />
                </button>
              </Show>
            </header>
            <div
              ref={(element) => {
                body = element;
              }}
              class={`overlay-dialog-body overlay-dialog-body--${presentation()} ${props.bodyClass ?? ''}`}
            >
              {/* Data loading inside a sheet waits here, not in the page's boundary behind it
                  (that swapped the whole page for its skeleton while the sheet opened). */}
              <Suspense fallback={<SkeletonLines label="Загружаем" lines={3} />}>
                {props.children}
              </Suspense>
            </div>
            <ScrollIndicator target={() => body} />
          </section>
        </div>
      </Portal>
    </Show>
  );
}
