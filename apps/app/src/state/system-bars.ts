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
