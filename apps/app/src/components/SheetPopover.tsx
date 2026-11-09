import { Popover } from '@kobalte/core/popover';
import { createSignal, type JSX, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { useNarrowViewport } from '@/components/narrow-viewport';
import { OverlayDialog } from '@/components/OverlayDialog';
import { ScrollIndicator } from '@/components/ScrollIndicator';
import { useHistoryLayer } from '@/state/use-history-layer';

import '@/components/SheetPopover.css';
import '@/components/menu-owner.css';

/** The class a trigger carries while its menu or panel is open (`styles/menu-owner.css`). */
export const MENU_OWNER_OPEN_CLASS = 'menu-owner--open';

/**
 * A panel that opens from a button: a popover beside the button on wide screens, the shared paper
 * sheet from the bottom edge on phones. The content is the same in both.
 *
 * While it is open the button stays pressed, ringed in the accent the panel's border repeats, so the
 * panel visibly belongs to it (owner 2026-11-08). A popover taller than the room under its button
 * scrolls inside itself, with the themed thumb, instead of running off the screen.
 */
export function SheetPopover(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Names the panel: the popover's accessible name and the sheet's heading. */
  readonly title: string;
  readonly triggerClass: string;
  readonly triggerClassList?: Record<string, boolean>;
  readonly triggerLabel: string;
  readonly triggerTitle?: string;
  readonly triggerRef?: (element: HTMLButtonElement) => void;
  /** The trigger sits inside a clickable card: its click must not reach the card. */
  readonly stopTriggerClick?: boolean;
  readonly trigger: JSX.Element;
  readonly contentClass: string;
  readonly contentRef?: (element: HTMLElement) => void;
  readonly onOpenAutoFocus?: (event: Event) => void;
  readonly placement?: 'bottom-start' | 'bottom-end';
  readonly children: JSX.Element;
}): JSX.Element {
  const narrow = useNarrowViewport();
  const [floating, setFloating] = createSignal<HTMLElement>();
  const triggerClassList = (): Record<string, boolean> => ({
    ...props.triggerClassList,
    [MENU_OWNER_OPEN_CLASS]: props.open,
  });
  // The panel is a history layer in both forms (sheet on phones, popover on wide screens).
  useHistoryLayer(
    () => props.open,
    () => props.onOpenChange(false),
  );
  return (
    <Show
      when={narrow()}
      fallback={
        <Popover
          open={props.open}
          onOpenChange={props.onOpenChange}
          placement={props.placement ?? 'bottom-start'}
          gutter={6}
          fitViewport
          overflowPadding={8}
        >
          <Popover.Trigger
            ref={(element: HTMLButtonElement) => props.triggerRef?.(element)}
            class={props.triggerClass}
            classList={triggerClassList()}
            aria-label={props.triggerLabel}
            title={props.triggerTitle}
            onClick={(event: MouseEvent) => {
              if (!props.stopTriggerClick) return;
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            {props.trigger}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              ref={(element: HTMLElement) => {
                setFloating(element);
                props.contentRef?.(element);
              }}
              class={`${props.contentClass} sheet-popover__floating scrollbar-themed`}
              aria-label={props.title}
              // Escape closes this popover only: a dialog under it listens on the window.
              onEscapeKeyDown={(event: KeyboardEvent) => event.stopPropagation()}
              {...(props.onOpenAutoFocus ? { onOpenAutoFocus: props.onOpenAutoFocus } : {})}
            >
              {props.children}
            </Popover.Content>
          </Popover.Portal>
          {/* Keyed: each opening mounts a new panel element, and the thumb follows that one. */}
          <Show when={props.open ? floating() : undefined} keyed>
            {(element) => (
              <Portal>
                <ScrollIndicator target={() => element} fixed />
              </Portal>
            )}
          </Show>
        </Popover>
      }
    >
      <button
        ref={(element) => props.triggerRef?.(element)}
        type="button"
        class={props.triggerClass}
        classList={triggerClassList()}
        aria-label={props.triggerLabel}
        title={props.triggerTitle}
        aria-haspopup="dialog"
        aria-expanded={props.open}
        onClick={(event) => {
          if (props.stopTriggerClick) {
            event.preventDefault();
            event.stopPropagation();
          }
          props.onOpenChange(!props.open);
        }}
      >
        {props.trigger}
      </button>
      <OverlayDialog
        open={props.open}
        title={props.title}
        tracksHistory={false}
        class="sheet-popover"
        onClose={() => props.onOpenChange(false)}
      >
        <div
          ref={(element) => props.contentRef?.(element)}
          class={`${props.contentClass} sheet-popover__content`}
        >
          {props.children}
        </div>
      </OverlayDialog>
    </Show>
  );
}
