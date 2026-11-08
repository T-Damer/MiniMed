import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

/**
 * A text is folded only when folding hides at least this many lines (owner 2026-11-08): a «Показать
 * ещё» that opens one or two lines — often just the line the button itself covered — is no use, so
 * such a text is shown whole, with no button.
 */
export const MIN_HIDDEN_LINES = 3;

/** How many lines a box of this content height holds at this line height. */
export function lineCount(contentHeight: number, lineHeight: number): number {
  if (!(lineHeight > 0) || !(contentHeight > 0)) return 0;
  // A line box can come out a pixel short or long of the line height; round, never truncate.
  return Math.round(contentHeight / lineHeight);
}

/** Whether a text of `lines` lines is folded to `visibleLines` (see `MIN_HIDDEN_LINES`). */
export function shouldFold(
  lines: number,
  visibleLines: number,
  minHidden = MIN_HIDDEN_LINES,
): boolean {
  return lines - visibleLines >= minHidden;
}

/**
 * How many of `total` list items to show before a «Показать ещё N»: `limit`, unless that would hide
 * fewer than `MIN_HIDDEN_LINES` items — then all of them, with no button (same rule as for text).
 */
export function visibleItemCount(
  total: number,
  limit: number,
  minHidden = MIN_HIDDEN_LINES,
): number {
  return shouldFold(total, limit, minHidden) ? limit : total;
}

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The line height of an element in pixels («normal» is taken as 1.2 × the font size). */
export function elementLineHeight(style: CSSStyleDeclaration): number {
  const lineHeight = pixels(style.lineHeight);
  return lineHeight > 0 ? lineHeight : pixels(style.fontSize) * 1.2;
}

/**
 * Lines of text in an element, folded or not: `scrollHeight` is the whole content even while a line
 * clamp cuts the box (padding is taken off).
 */
export function measuredLines(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const content = element.scrollHeight - pixels(style.paddingTop) - pixels(style.paddingBottom);
  return lineCount(content, elementLineHeight(style));
}

export interface LineClamp {
  /** The text is long enough to fold: show the toggle. */
  readonly foldable: Accessor<boolean>;
  /** Folded now: apply the clamp class (and the fade). */
  readonly folded: Accessor<boolean>;
  readonly expanded: Accessor<boolean>;
  readonly toggle: () => void;
}

/**
 * The one fold rule for texts with «Показать ещё» / «Показать полностью» (AGENTS.md «Fold only what
 * is worth unfolding»): the element is measured on every width change, and it is folded to
 * `visibleLines` only when that hides `MIN_HIDDEN_LINES` or more; a shorter text shows whole.
 * `track` lists what changes the text (the text itself), so it is measured again.
 */
export function createLineClamp(options: {
  readonly element: Accessor<HTMLElement | undefined>;
  readonly visibleLines: number;
  readonly track?: Accessor<unknown>;
}): LineClamp {
  const [foldable, setFoldable] = createSignal(false);
  const [measured, setMeasured] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const measure = (): void => {
    const element = options.element();
    if (!element?.isConnected) return;
    setFoldable(shouldFold(measuredLines(element), options.visibleLines));
    setMeasured(true);
  };
  createEffect(() => {
    options.track?.();
    const element = options.element();
    if (!element) return;
    // After layout: the first frame the element is on screen with its final width.
    let frame = requestAnimationFrame(measure);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
          });
    observer?.observe(element);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    });
  });
  return {
    foldable,
    // Folded until measured: a long text never shows whole for a frame and then jumps shut.
    folded: () => !expanded() && (measured() ? foldable() : true),
    expanded,
    toggle: () => setExpanded((value) => !value),
  };
}
