import { expect, type Page } from '@playwright/test';

/**
 * Shared contrast audit (owner 2026-11-08: element contrast is checked in both themes; a poor
 * element has to change). Both finders run inside the page through `page.evaluate`, so each is
 * self-contained: nothing outside the function body may be referenced.
 *
 * - {@link findContrastProblems}: every visible text node against its composited background,
 *   WCAG 2.x, 4.5:1 for text and 3:1 for large text (24 px, or 18.66 px bold).
 * - {@link findIconProblems}: the glyph of every icon-only button or link against its background,
 *   3:1 (WCAG 1.4.11 non-text contrast).
 */

export interface Finding {
  readonly kind: string;
  readonly what: string;
}

export interface ContrastOptions {
  /** CSS selector of the element to scan (a sheet over a page); the whole body when absent. */
  readonly scope?: string | undefined;
  /** Selector of content left out (illustrations, disabled controls). */
  readonly skip?: string | undefined;
  /** Count the opacity of the element and its ancestors as part of its colour. */
  readonly opacity?: boolean | undefined;
}

/** Runs in the page: text contrast. */
export function findContrastProblems(options: ContrastOptions): Finding[] {
  const root = (options.scope ? document.querySelector(options.scope) : null) ?? document.body;
  const skip = ['script', 'style', 'noscript', options.skip].filter(Boolean).join(', ');
  const found: Finding[] = [];
  const describe = (element: Element): string =>
    `${element.tagName.toLowerCase()}.${String(element.getAttribute('class') ?? '').split(' ')[0]} «${(element.textContent ?? '').trim().slice(0, 40)}»`;
  const shown = (element: Element): boolean => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.display !== 'none'
    );
  };
  const parse = (css: string): [number, number, number, number] => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return [0, 0, 0, 1];
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const luminance = ([r, g, b]: readonly number[]): number => {
    const channel = (value: number): number => {
      const unit = value / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
  };
  const background = (element: Element): [number, number, number] => {
    const layers: [number, number, number, number][] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color[3] > 0) layers.push(color);
      if (color[3] >= 0.999) break;
      // A hero header stands on its band (components/PageHero.tsx), drawn behind it: what is not
      // covered by a layer of its own inside the hero is on the band.
      if (node.classList.contains('page--hero')) {
        layers.push(parse(getComputedStyle(node).getPropertyValue('--page-hero-band').trim()));
        break;
      }
    }
    let [r, g, b] = [255, 255, 255];
    for (const [lr, lg, lb, la] of layers.toReversed()) {
      r = lr * la + r * (1 - la);
      g = lg * la + g * (1 - la);
      b = lb * la + b * (1 - la);
    }
    return [r, g, b];
  };
  const opacityOf = (element: Element): number => {
    let opacity = 1;
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (options.opacity) opacity *= Number.parseFloat(getComputedStyle(node).opacity);
    }
    return opacity;
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    const element = node.parentElement;
    if (!text || !element || !shown(element) || element.closest(skip)) continue;
    // Text a reader never sees: screen-reader-only, aria-hidden, or beside the viewport (the
    // neighbours a carousel shows at its edge).
    if (element.closest('[aria-hidden="true"], [hidden], [inert], .sr-only, .visually-hidden')) {
      continue;
    }
    const box = element.getBoundingClientRect();
    if (box.right < 0 || box.left > window.innerWidth) continue;
    const style = getComputedStyle(element);
    const size = Number.parseFloat(style.fontSize);
    const [fr = 0, fg = 0, fb = 0, fa = 1] = parse(style.color);
    const [br = 0, bg = 0, bb = 0] = background(element);
    const alpha = fa * opacityOf(element);
    if (alpha <= 0) continue;
    const foreground = [
      fr * alpha + br * (1 - alpha),
      fg * alpha + bg * (1 - alpha),
      fb * alpha + bb * (1 - alpha),
    ];
    const light = Math.max(luminance(foreground), luminance([br, bg, bb]));
    const dark = Math.min(luminance(foreground), luminance([br, bg, bb]));
    const ratio = (light + 0.05) / (dark + 0.05);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) {
      found.push({
        kind: 'contrast',
        what: `${describe(element)} has ${ratio.toFixed(2)}:1 (${style.color} on rgb(${Math.round(br)}, ${Math.round(bg)}, ${Math.round(bb)}))`,
      });
    }
  }
  return found;
}

/** Runs in the page: the glyph of every icon-only control against the control's background. */
export function findIconProblems(options: ContrastOptions): Finding[] {
  const root = (options.scope ? document.querySelector(options.scope) : null) ?? document.body;
  const found: Finding[] = [];
  const parse = (css: string): [number, number, number, number] => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return [0, 0, 0, 1];
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const luminance = ([r, g, b]: readonly number[]): number => {
    const channel = (value: number): number => {
      const unit = value / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
  };
  const opacityOf = (element: Element): number => {
    let opacity = 1;
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (options.opacity) opacity *= Number.parseFloat(getComputedStyle(node).opacity);
    }
    return opacity;
  };
  const backgroundOf = (element: Element): [number, number, number] => {
    const layers: [number, number, number, number][] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color[3] > 0) layers.push(color);
      if (color[3] >= 0.999) break;
      // A hero header stands on its band (components/PageHero.tsx), drawn behind it: what is not
      // covered by a layer of its own inside the hero is on the band.
      if (node.classList.contains('page--hero')) {
        layers.push(parse(getComputedStyle(node).getPropertyValue('--page-hero-band').trim()));
        break;
      }
    }
    let [r, g, b] = [255, 255, 255];
    for (const [lr, lg, lb, la] of layers.toReversed()) {
      r = lr * la + r * (1 - la);
      g = lg * la + g * (1 - la);
      b = lb * la + b * (1 - la);
    }
    return [r, g, b];
  };

  const controls = root.querySelectorAll('button, a[href], [role="button"], summary');
  for (const control of controls) {
    if (control.closest('[aria-hidden="true"], [hidden], [inert], :disabled')) continue;
    if (options.skip && control.closest(options.skip)) continue;
    const box = control.getBoundingClientRect();
    const style = getComputedStyle(control);
    if (box.width < 1 || box.height < 1 || style.visibility === 'hidden') continue;
    if (box.right < 0 || box.left > window.innerWidth) continue;
    if ((control.textContent ?? '').trim() !== '') continue;
    const glyph = control.querySelector('svg');
    if (!glyph) continue;
    const glyphStyle = getComputedStyle(glyph);
    // Outline icons paint with their stroke, solid ones with their fill; the first of the
    // shapes that is painted decides (an svg's own values are inherited by its shapes).
    let paint = glyphStyle.color;
    const shapes = glyph.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse');
    for (const shape of shapes) {
      const shapeStyle = getComputedStyle(shape);
      if (shapeStyle.stroke !== 'none' && Number.parseFloat(shapeStyle.strokeWidth) > 0) {
        paint = shapeStyle.stroke;
        break;
      }
      if (shapeStyle.fill !== 'none') {
        paint = shapeStyle.fill;
        break;
      }
    }
    const [fr = 0, fg = 0, fb = 0, fa = 1] = parse(paint);
    const [br = 0, bg = 0, bb = 0] = backgroundOf(control);
    const alpha = fa * opacityOf(glyph);
    const foreground = [
      fr * alpha + br * (1 - alpha),
      fg * alpha + bg * (1 - alpha),
      fb * alpha + bb * (1 - alpha),
    ];
    const light = Math.max(luminance(foreground), luminance([br, bg, bb]));
    const dark = Math.min(luminance(foreground), luminance([br, bg, bb]));
    const ratio = (light + 0.05) / (dark + 0.05);
    if (ratio < 3) {
      const name = control.getAttribute('aria-label') ?? control.getAttribute('title') ?? '';
      found.push({
        kind: 'icon-contrast',
        what: `${control.tagName.toLowerCase()}.${String(control.getAttribute('class') ?? '').split(' ')[0]} «${name}» glyph has ${ratio.toFixed(2)}:1 (${paint} on rgb(${Math.round(br)}, ${Math.round(bg)}, ${Math.round(bb)}))`,
      });
    }
  }
  return found;
}

/** Collects the text findings (and the icon findings with `icons`) of what is on screen. */
export async function contrastFindings(
  page: Page,
  options: ContrastOptions & { readonly icons?: boolean } = {},
): Promise<Finding[]> {
  const { icons, ...scan } = options;
  if (scan.opacity) {
    // Opacity is part of the colour a reader sees: let sheets and pages that fade in settle first
    // (bounded: an animation that never ends is scanned as it is).
    await page.evaluate(() =>
      Promise.race([
        Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY)
            .map((a) => a.finished.catch(() => undefined)),
        ),
        new Promise((done) => setTimeout(done, 1200)),
      ]),
    );
  }
  const text = await page.evaluate(findContrastProblems, scan);
  return icons ? [...text, ...(await page.evaluate(findIconProblems, scan))] : text;
}

/**
 * Soft-asserts that no text (and, with `icons`, no icon-only control) on screen is below the
 * floor. Soft: one screen's findings must not hide those of the screens after it.
 */
export async function checkContrast(
  page: Page,
  name: string,
  scope?: string,
  options: Omit<ContrastOptions, 'scope'> & { readonly icons?: boolean } = {},
): Promise<void> {
  expect.soft(await contrastFindings(page, { ...options, scope }), name).toEqual([]);
}
