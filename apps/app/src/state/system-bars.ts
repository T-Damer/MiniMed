import { Capacitor, SystemBars, SystemBarsStyle, SystemBarType } from '@capacitor/core';

/*
 * The status bar's text colour in the native apps. By default it follows the theme (dark text on
 * the light pages); a dark surface under it — a root page's hero band or its pinned bar
 * (components/PageHero.tsx) — holds light text until it lets go. The installed web app has
 * `black-translucent` (always light) and is left alone.
 */

let holds = 0;
let applied: SystemBarsStyle | undefined;

function apply(): void {
  if (!Capacitor.isNativePlatform()) return;
  const style = holds > 0 ? SystemBarsStyle.Dark : SystemBarsStyle.Default;
  if (style === applied) return;
  applied = style;
  SystemBars.setStyle({ style, bar: SystemBarType.StatusBar }).catch((error: unknown) => {
    applied = undefined;
    console.warn('system bars: style not applied', error instanceof Error ? error.name : error);
  });
}

/** Light status-bar text while a dark surface is under it; call the result to let go. */
export function holdLightStatusBar(): () => void {
  holds += 1;
  apply();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    apply();
  };
}

/**
 * Light status-bar text while the shell's status cap is shown (styles/compact-release.css): it is
 * displayed exactly while the active page has a band, whose band, pinned bar or cap is then under
 * the status bar however far the page has scrolled. The band's own hold (PageHero) let go as soon as
 * the band scrolled away, leaving dark text on the dark pinned bar.
 */
export function holdLightStatusBarWhileShown(element: HTMLElement): () => void {
  let release: (() => void) | undefined;
  const update = (shown: boolean): void => {
    if (shown) release ??= holdLightStatusBar();
    else {
      release?.();
      release = undefined;
    }
  };
  const observer = new ResizeObserver(([entry]) => update((entry?.contentRect.height ?? 0) > 0));
  observer.observe(element);
  return () => {
    observer.disconnect();
    update(false);
  };
}
