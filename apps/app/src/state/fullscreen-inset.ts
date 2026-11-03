/**
 * An installed web app in full screen (DIARY21, owner 2026-11-03: Edge paints its own grey status
 * bar over a standalone app in the dark theme and ignores `theme-color`). The system bars are
 * hidden and slide over the page when pulled down; while they are out, Android reports a taller top
 * inset, which moved every header down and back (DIARY17's «jump»). The top inset (the camera
 * cutout) is read once at start and after a rotation, and pinned in `--safe-top`.
 */

function readTopInset(): string {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)';
  document.body.append(probe);
  const top = getComputedStyle(probe).paddingTop;
  probe.remove();
  return top;
}

export function pinFullscreenTopInset(): () => void {
  const query = window.matchMedia?.('(display-mode: fullscreen)');
  if (!query?.matches) return () => undefined;
  const root = document.documentElement;
  const pin = (): void => {
    root.style.setProperty('--safe-top', readTopInset());
    root.classList.add('display-fullscreen');
  };
  pin();
  // A rotation moves the cutout to another edge: read it again once the turn has settled.
  let timer = 0;
  const turned = (): void => {
    window.clearTimeout(timer);
    root.style.removeProperty('--safe-top');
    timer = window.setTimeout(pin, 400);
  };
  screen.orientation?.addEventListener('change', turned);
  return () => {
    window.clearTimeout(timer);
    screen.orientation?.removeEventListener('change', turned);
  };
}
