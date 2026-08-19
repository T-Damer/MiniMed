const NAV_SAFE_BOTTOM_VAR = '--nav-safe-bottom';

export function nextLockedInsetFloor(floorPx: number, observedPx: number): number {
  return observedPx > floorPx ? observedPx : floorPx;
}

function readPx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readSafeBottomPx(root: HTMLElement): number {
  const styles = getComputedStyle(root);
  return Math.max(
    readPx(styles.getPropertyValue('--safe-area-inset-bottom')),
    readPx(styles.getPropertyValue('--safe-bottom')),
  );
}

/** Keep the bottom nav from dropping when Capacitor briefly reports a 0 inset during navigation. */
export function lockNativeSafeBottom(root: HTMLElement = document.documentElement): () => void {
  let floorPx = 0;
  const sync = (): void => {
    const next = nextLockedInsetFloor(floorPx, readSafeBottomPx(root));
    if (next === floorPx) return;
    floorPx = next;
    root.style.setProperty(NAV_SAFE_BOTTOM_VAR, `${floorPx}px`);
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(root, { attributes: true, attributeFilter: ['style'] });
  window.visualViewport?.addEventListener('resize', sync);
  document.addEventListener('visibilitychange', sync);
  return () => {
    observer.disconnect();
    window.visualViewport?.removeEventListener('resize', sync);
    document.removeEventListener('visibilitychange', sync);
  };
}
