import type { JSX } from 'solid-js';

export interface UseLongClickOptions {
  readonly onLongClick: () => void;
  /** Regular click; suppressed automatically when a long click just fired. */
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  /** Only trigger on touch/coarse pointers — desktop uses the context menu. */
  readonly mobileOnly?: boolean;
  readonly delayMs?: number;
}

export interface LongClickHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onClick: (event: MouseEvent) => void;
}

/**
 * Long-press gesture that survives small finger drift: cancelled by pointer
 * movement beyond a slop radius or by leaving the element. With
 * `mobileOnly`, desktop pointers never start the timer — right-click menus
 * cover them instead.
 */
export function useLongClick(options: UseLongClickOptions): LongClickHandlers {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let suppressNextClick = false;
  let startPoint: { x: number; y: number } | null = null;
  let lastPoint: { x: number; y: number } | null = null;

  const clear = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    startPoint = null;
    lastPoint = null;
  };

  const applies = (event: PointerEvent): boolean => {
    if (options.disabled) return false;
    if (!options.mobileOnly) return true;
    return event.pointerType === 'touch' || window.matchMedia('(pointer: coarse)').matches;
  };

  return {
    onPointerDown: (event: PointerEvent) => {
      if (!applies(event)) return;
      startPoint = { x: event.clientX, y: event.clientY };
      lastPoint = { ...startPoint };
      timer = setTimeout(() => {
        timer = undefined;
        const start = startPoint;
        const last = lastPoint;
        if (start && last && Math.hypot(last.x - start.x, last.y - start.y) > 12) {
          clear();
          return;
        }
        suppressNextClick = true;
        options.onLongClick();
        clear();
      }, options.delayMs ?? 500);
    },
    onPointerMove: (event: PointerEvent) => {
      if (!timer) return;
      lastPoint = { x: event.clientX, y: event.clientY };
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClick: (event: MouseEvent) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      options.onClick?.();
    },
  } satisfies LongClickHandlers & JSX.HTMLAttributes<HTMLElement>;
}
