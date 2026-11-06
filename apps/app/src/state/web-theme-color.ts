/**
 * The browser's `theme-color` follows what is under the status bar (owner 2026-11-03: in an
 * installed web app the bar should match the page header, not show a fixed paper colour).
 * A page with a hero band (components/PageHero.css) has the band at the top whether it is scrolled
 * or not (the band, then the pinned bar), so it gives the band's colour; any other page gives the
 * first opaque background under the top edge. The browser's `theme-color` is for web builds; the
 * Android app keeps a transparent bar and takes only the icon shade from here
 * (`watchTopEdgeContrast`, state/native-system-ui.ts).
 */

const TRANSPARENT = /^(transparent|rgba\([^)]*,\s*0\))$/u;

function opaqueBackground(element: Element | null): string | undefined {
  for (let node = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color && !TRANSPARENT.test(color)) return color;
  }
  return undefined;
}

/** The colour the top edge of the screen shows now. */
export function topEdgeColor(): string | undefined {
  // Pages kept alive behind the current one are hidden: the shown one has a box on screen.
  for (const hero of Array.from(document.querySelectorAll('.page--hero'))) {
    if (!hero.getClientRects().length) continue;
    const band = getComputedStyle(hero).getPropertyValue('--page-hero-band').trim();
    if (band) return band;
  }
  const probe = document.elementFromPoint(Math.round(window.innerWidth / 2), 1);
  return opaqueBackground(probe) ?? opaqueBackground(document.body);
}

function themeMeta(): HTMLMetaElement {
  const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
  // One tag the page owns: media-specific variants would override it.
  for (const extra of metas.slice(1)) extra.remove();
  const meta = metas[0] ?? document.createElement('meta');
  if (!meta.isConnected) {
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  meta.removeAttribute('media');
  return meta;
}

let colorProbe: HTMLSpanElement | undefined;

/** Any CSS colour (a token, `color-mix`) as the browser computes it: `rgb(…)` / `rgba(…)`. */
function computedColor(value: string): string {
  if (!colorProbe) {
    colorProbe = document.createElement('span');
    colorProbe.hidden = true;
    document.body.append(colorProbe);
  }
  colorProbe.style.color = '';
  colorProbe.style.color = value;
  return getComputedStyle(colorProbe).color;
}

/**
 * Whether a colour is light enough for dark status-bar icons (WCAG relative luminance). Undefined
 * for a colour that cannot be read.
 */
export function wantsDarkIcons(color: string): boolean | undefined {
  const channels = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/u.exec(computedColorOf(color));
  if (!channels) return undefined;
  const linear = channels.slice(1, 4).map((channel) => {
    const value = Number(channel) / 255;
    return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
  // Above ~0.18 dark icons read better than light ones (equal contrast point of black and white).
  return luminance > 0.18;
}

function computedColorOf(color: string): string {
  return /^rgba?\(/u.test(color) ? color : computedColor(color);
}

/**
 * Keeps the Android status-bar icons readable over what is under them (owner 2026-11-06): a dark
 * hero band in the light theme took dark icons from the theme and hid them. Calls `apply` with the
 * icon shade the top edge needs; returns a stop function.
 */
export function watchTopEdgeContrast(apply: (darkIcons: boolean) => void): () => void {
  let timer = 0;
  let last: boolean | undefined;
  const sync = (): void => {
    timer = 0;
    const color = topEdgeColor();
    const dark = color ? wantsDarkIcons(color) : undefined;
    if (dark === undefined || dark === last) return;
    last = dark;
    apply(dark);
  };
  const schedule = (): void => {
    if (!timer) timer = window.setTimeout(sync, 100);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('hashchange', schedule);
  schedule();
  return () => {
    if (timer) window.clearTimeout(timer);
    observer.disconnect();
    window.removeEventListener('scroll', schedule, { capture: true });
    window.removeEventListener('hashchange', schedule);
  };
}

/** Keeps `theme-color` in step with the page; returns a stop function. */
export function installWebThemeColor(): () => void {
  const meta = themeMeta();
  let timer = 0;
  const sync = (): void => {
    timer = 0;
    const color = topEdgeColor();
    if (color && meta.content !== color) meta.content = color;
  };
  // Throttled: a scroll or a burst of renders reads the colour once per ~0.1 s.
  const schedule = (): void => {
    if (!timer) timer = window.setTimeout(sync, 100);
  };
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('hashchange', schedule);
  scheme.addEventListener('change', schedule);
  schedule();
  return () => {
    if (timer) window.clearTimeout(timer);
    observer.disconnect();
    window.removeEventListener('scroll', schedule, { capture: true });
    window.removeEventListener('resize', schedule);
    window.removeEventListener('hashchange', schedule);
    scheme.removeEventListener('change', schedule);
  };
}
