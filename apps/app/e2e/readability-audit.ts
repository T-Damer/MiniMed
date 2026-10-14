import type { Page } from '@playwright/test';

/** One text that fails the contrast floor, as the in-page audit reports it. */
export interface ContrastFailure {
  readonly text: string;
  readonly selector: string;
  readonly ratio: number;
  readonly need: number;
  readonly foreground: string;
  readonly background: string;
  readonly fontSize: number;
}

/** One control that is smaller than a finger on a coarse or fine pointer alike (44 CSS px). */
export interface SmallTarget {
  readonly selector: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

/** A visible in-flow element that a fixed element sits over at the end of the page. */
export interface CoveredElement {
  readonly selector: string;
  readonly text: string;
  readonly overlap: number;
}

/**
 * Contrast of every visible text node in the page against its own background, WCAG 2.x: 4.5:1 for
 * text, 3:1 for large text (24 px, or 18.66 px bold). The background is the nearest opaque colour
 * layers composited from the element up (a gradient desk counts as its flat end colour, the darker
 * of its two). Skipped: hidden or `aria-hidden` content, disabled controls, text that is not wholly
 * inside the viewport sideways (the neighbours a carousel shows at its edges), and `sr-only` text.
 */
export async function contrastFailures(page: Page): Promise<readonly ContrastFailure[]> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return [];
    interface Rgba {
      r: number;
      g: number;
      b: number;
      a: number;
    }
    const parse = (color: string): Rgba => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = '#000';
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      return { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0, a: (data[3] ?? 0) / 255 };
    };
    const channel = (value: number): number => {
      const unit = value / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (c: Rgba): number =>
      0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    const ratio = (a: Rgba, b: Rgba): number => {
      const x = luminance(a);
      const y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const hex = (c: Rgba): string =>
      `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    const describe = (element: Element): string => {
      const className =
        typeof element.className === 'string'
          ? element.className.trim().split(/\s+/u).slice(0, 2).join('.')
          : '';
      return className
        ? `${element.tagName.toLowerCase()}.${className}`
        : element.tagName.toLowerCase();
    };
    const backdrop = (element: Element): { color: Rgba; opacity: number } => {
      const layers: Rgba[] = [];
      let opacity = 1;
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        opacity *= Number.parseFloat(style.opacity);
        const background = parse(style.backgroundColor);
        if (background.a > 0) layers.push(background);
        if (background.a >= 1) break;
      }
      let base: Rgba = { r: 255, g: 255, b: 255, a: 1 };
      for (const layer of layers.toReversed()) {
        base = {
          r: layer.r * layer.a + base.r * (1 - layer.a),
          g: layer.g * layer.a + base.g * (1 - layer.a),
          b: layer.b * layer.a + base.b * (1 - layer.a),
          a: 1,
        };
      }
      return { color: base, opacity };
    };
    const failures: {
      text: string;
      selector: string;
      ratio: number;
      need: number;
      foreground: string;
      background: string;
      fontSize: number;
    }[] = [];
    const seen = new Set<string>();
    for (const element of document.querySelectorAll('body *')) {
      const ownText = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join(' ')
        .replace(/\s+/gu, ' ')
        .trim();
      if (ownText === '') continue;
      if (element.closest('[aria-hidden="true"], [hidden], [inert], .sr-only, [disabled]'))
        continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.left < -1 || rect.right > window.innerWidth + 1) continue;
      const { color: background, opacity } = backdrop(element);
      const foreground = parse(style.color);
      const alpha = foreground.a * opacity;
      if (alpha <= 0) continue;
      const blended: Rgba = {
        r: foreground.r * alpha + background.r * (1 - alpha),
        g: foreground.g * alpha + background.g * (1 - alpha),
        b: foreground.b * alpha + background.b * (1 - alpha),
        a: 1,
      };
      const fontSize = Number.parseFloat(style.fontSize);
      const weight = Number.parseInt(style.fontWeight, 10) || 400;
      const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      const value = ratio(blended, background);
      if (value >= need) continue;
      const key = `${ownText}|${value.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push({
        text: ownText.slice(0, 60),
        selector: describe(element),
        ratio: Math.round(value * 100) / 100,
        need,
        foreground: hex(blended),
        background: hex(background),
        fontSize,
      });
    }
    return failures;
  });
}

/**
 * Visible controls whose touch target is under 44 px in width or height. A target is the control's
 * box, or the `::after` hit area it carries (an absolutely positioned pseudo-element that reaches
 * past the visible control), whichever is larger.
 */
export async function smallTargets(
  page: Page,
  selector = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], summary',
): Promise<readonly SmallTarget[]> {
  return page.evaluate((query) => {
    const MIN = 44;
    const small: { selector: string; label: string; width: number; height: number }[] = [];
    for (const element of document.querySelectorAll(query)) {
      if (element.closest('[aria-hidden="true"], [hidden], [inert], .sr-only')) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.right < 0 || rect.left > window.innerWidth) continue;
      let width = rect.width;
      let height = rect.height;
      const after = getComputedStyle(element, '::after');
      if (after.content !== 'none' && after.position === 'absolute') {
        width = Math.max(width, Number.parseFloat(after.width) || 0);
        height = Math.max(height, Number.parseFloat(after.height) || 0);
      }
      if (width >= MIN - 0.5 && height >= MIN - 0.5) continue;
      small.push({
        selector: `${element.tagName.toLowerCase()}.${String(element.className).trim().split(/\s+/u)[0] ?? ''}`,
        label: (element.getAttribute('aria-label') ?? element.textContent ?? '')
          .trim()
          .slice(0, 40),
        width: Math.round(width),
        height: Math.round(height),
      });
    }
    return small;
  }, selector);
}

/**
 * Scrolls to the end of the page and lists every visible in-flow text or control that the bottom
 * navigation covers there. Fixed and sticky elements are not content.
 */
export async function coveredByNavigation(page: Page): Promise<readonly CoveredElement[]> {
  // A virtualised list grows while it is scrolled: go to the end until the end stops moving.
  let previous = -1;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const height = await page.evaluate(() => {
      const candidates = [document.scrollingElement, ...document.querySelectorAll('*')].filter(
        (element): element is Element =>
          element !== null &&
          element.scrollHeight > element.clientHeight + 50 &&
          !['visible', 'hidden'].includes(getComputedStyle(element).overflowY),
      );
      // The page itself scrolls unless it cannot; a hidden route kept mounted must not be picked.
      const root = document.scrollingElement;
      const scroller =
        root && root.scrollHeight > root.clientHeight + 50
          ? root
          : candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
      return scroller?.scrollHeight ?? 0;
    });
    await page.waitForTimeout(350);
    if (height === previous) break;
    previous = height;
  }
  return page.evaluate(() => {
    const navigation = document.querySelector('.app-bottom-nav');
    if (!navigation) return [];
    const bar = navigation.getBoundingClientRect();
    const covered: { selector: string; text: string; overlap: number }[] = [];
    const query =
      'a[href], button, input, textarea, select, [role="button"], p, li, h1, h2, h3, h4, label, summary, td, th';
    for (const element of document.querySelectorAll(query)) {
      if (navigation.contains(element)) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      let floating = false;
      for (
        let node: Element | null = element;
        node && node !== document.body;
        node = node.parentElement
      ) {
        const position = getComputedStyle(node).position;
        if (position === 'fixed' || position === 'sticky') {
          floating = true;
          break;
        }
      }
      if (floating) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const text = (element instanceof HTMLElement ? element.innerText : '').trim();
      if (text === '' && !element.matches('input, textarea, select, button')) continue;
      const across = Math.min(rect.right, bar.right) - Math.max(rect.left, bar.left);
      const down = Math.min(rect.bottom, bar.bottom) - Math.max(rect.top, bar.top);
      if (across > 2 && down > 2) {
        covered.push({
          selector: `${element.tagName.toLowerCase()}.${String(element.className).trim().split(/\s+/u)[0] ?? ''}`,
          text: text.slice(0, 40),
          overlap: Math.round(down),
        });
      }
    }
    return covered;
  });
}
