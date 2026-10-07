/**
 * On phones the reader's outline is a drawer over the page. Class on `<html>` while it is open: the
 * bottom navigation lives outside the reader's stacking context (it is portalled to `<body>`), so
 * no z-index inside the page can lift the drawer above it; the navigation slides away instead.
 */
export const OUTLINE_DRAWER_ROOT_CLASS = 'reader-outline-open';

/** The drawer's slide-out (`transition: transform 200ms` in doctor-ux.css); the class outlasts it. */
export const OUTLINE_DRAWER_CLOSE_MS = 220;

export function isOutlineDrawerOpen(outlineOpen: boolean, desktopLayout: boolean): boolean {
  return outlineOpen && !desktopLayout;
}

export interface OutlineEscapeContext {
  readonly drawerOpen: boolean;
  /** The header's find field is open: Escape belongs to it first. */
  readonly findOpen: boolean;
}

export function shouldCloseOutlineOnEscape(
  event: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'isComposing'>,
  context: OutlineEscapeContext,
): boolean {
  return (
    event.key === 'Escape' &&
    !event.defaultPrevented &&
    !event.isComposing &&
    context.drawerOpen &&
    !context.findOpen
  );
}
