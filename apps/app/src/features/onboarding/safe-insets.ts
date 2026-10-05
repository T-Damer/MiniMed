import type { Size } from './onboarding-geometry';

export interface SafeInsets {
  readonly top: number;
  readonly bottom: number;
}

/**
 * The device's safe-area insets in CSS pixels (status bar, gesture bar), read through the same
 * `--safe-top` / `--safe-bottom` variables the rest of the app uses, so the tour keeps clear of
 * system bars exactly as the screens under it do.
 */
export function readSafeInsets(): SafeInsets {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;' +
    'padding-top:var(--safe-top,0px);padding-bottom:var(--safe-bottom,0px);';
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const insets = {
    top: Number.parseFloat(style.paddingTop) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
  };
  probe.remove();
  return insets;
}

/** The part of the viewport left once the insets are taken off. */
export function usableSize(viewport: Size, insets: SafeInsets): Size {
  return {
    width: viewport.width,
    height: Math.max(0, viewport.height - insets.top - insets.bottom),
  };
}
