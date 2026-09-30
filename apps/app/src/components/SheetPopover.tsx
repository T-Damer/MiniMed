import { Popover } from '@kobalte/core/popover';
import { type JSX, Show } from 'solid-js';

import { useNarrowViewport } from '@/components/narrow-viewport';
import { OverlayDialog } from '@/components/OverlayDialog';

import '@/components/SheetPopover.css';

/**
 * A panel that opens from a button: a popover beside the button on wide screens, the shared paper
 * sheet from the bottom edge on phones. The content is the same in both.
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
            classList={props.triggerClassList ?? {}}
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
              ref={(element: HTMLElement) => props.contentRef?.(element)}
              class={props.contentClass}
              aria-label={props.title}
              {...(props.onOpenAutoFocus ? { onOpenAutoFocus: props.onOpenAutoFocus } : {})}
            >
              {props.children}
            </Popover.Content>
          </Popover.Portal>
        </Popover>
      }
    >
      <button
        ref={(element) => props.triggerRef?.(element)}
        type="button"
        class={props.triggerClass}
        classList={props.triggerClassList ?? {}}
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
