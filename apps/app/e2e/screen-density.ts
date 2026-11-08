/**
 * Screen density (owner 2026-11-08, AGENTS.md «Fill the screen, avoid scrolling»): how much of the
 * first viewport carries content, and whether the page scrolls without being a list.
 *
 * No published tool or validated threshold exists for "too empty" (research note UI-BATCH3: Feature
 * Congestion, Subband Entropy and edge density predict clutter, not emptiness; Lighthouse and the
 * big companies publish nothing for fill). So the metric is the simple, deterministic one: the share
 * of 8 px cells of the first viewport touched by ink — text line boxes, images, controls, and boxes
 * with their own background or border — each grown by 6 px so the gaps inside a paragraph count as
 * filled and only real empty space stays empty. The thresholds below are starting points to be
 * calibrated on MiniMed's own screens.
 */
export interface ScreenDensity {
  /** Share of the first viewport covered by content (0–1). */
  readonly coverage: number;
  /** Tallest full-width empty band, as a share of the viewport height. */
  readonly maxEmptyBand: number;
  /** Empty height under the lowest content, as a share of the viewport height. */
  readonly bottomGap: number;
  /** The page (or its main scroll area) is taller than the screen. */
  readonly scrolls: boolean;
  /** How far it scrolls, in pixels. */
  readonly overflowPx: number;
  /** Most of what scrolls is a run of alike items (a list, a grid): scrolling is expected there. */
  readonly isList: boolean;
}

/** Below these the first screen is too empty (heuristic, see the note above). */
export const DENSITY_FLOOR = {
  phone: { coverage: 0.3, maxEmptyBand: 0.25 },
  tablet: { coverage: 0.25, maxEmptyBand: 0.3 },
} as const;

/** Runs in the page (`page.evaluate(measureScreenDensity)`); self-contained. */
export function measureScreenDensity(): ScreenDensity {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const cell = 8;
  const grow = 6;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const grid = new Uint8Array(cols * rows);
  const mark = (box: DOMRect): void => {
    if (box.width < 1 || box.height < 1 || box.bottom < 0 || box.top > height) return;
    if (box.right < 0 || box.left > width) return;
    const x0 = Math.max(0, Math.floor((box.left - grow) / cell));
    const x1 = Math.min(cols - 1, Math.floor((box.right + grow) / cell));
    const y0 = Math.max(0, Math.floor((box.top - grow) / cell));
    const y1 = Math.min(rows - 1, Math.floor((box.bottom + grow) / cell));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) grid[y * cols + x] = 1;
  };
  const transparent = (color: string): boolean =>
    color === 'transparent' || /rgba\([^)]*,\s*0\)$/u.test(color);
  const pageBackground = getComputedStyle(document.body).backgroundColor;
  const shown = (element: Element): boolean => {
    const style = getComputedStyle(element);
    return (
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      Number.parseFloat(style.opacity) > 0.05 &&
      !element.closest('[aria-hidden="true"], [inert]')
    );
  };

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (!parent || !(node.textContent ?? '').trim() || !shown(parent)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const box of Array.from(range.getClientRects())) mark(box);
      continue;
    }
    const element = node as HTMLElement;
    if (!shown(element)) continue;
    const box = element.getBoundingClientRect();
    if (/^(IMG|SVG|CANVAS|VIDEO|INPUT|SELECT|TEXTAREA|BUTTON)$/iu.test(element.tagName)) {
      mark(box);
      continue;
    }
    const style = getComputedStyle(element);
    const boxed =
      (!transparent(style.backgroundColor) && style.backgroundColor !== pageBackground) ||
      Number.parseFloat(style.borderTopWidth) > 0 ||
      style.backgroundImage !== 'none';
    // A wrapper that paints the whole screen (the shell, a page band) is the page, not content.
    if (boxed && box.width * box.height < width * height * 0.6) mark(box);
  }

  let filled = 0;
  let run = 0;
  let longestRun = 0;
  let lastInkRow = 0;
  for (let y = 0; y < rows; y += 1) {
    let any = false;
    for (let x = 0; x < cols; x += 1) {
      if (grid[y * cols + x]) {
        filled += 1;
        any = true;
      }
    }
    if (any) {
      lastInkRow = y + 1;
      run = 0;
    } else {
      run += 1;
      longestRun = Math.max(longestRun, run);
    }
  }

  const root = document.scrollingElement as HTMLElement | null;
  let scroller: HTMLElement | null = root && root.scrollHeight > height + 4 ? root : null;
  if (!scroller) {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const style = getComputedStyle(element);
      if (
        /(auto|scroll)/u.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight + 4 &&
        element.clientHeight > height * 0.5
      ) {
        scroller = element;
        break;
      }
    }
  }
  let overflowPx = 0;
  let isList = false;
  if (scroller) {
    overflowPx = scroller.scrollHeight - scroller.clientHeight;
    // A run of alike siblings (same tag, class and width: cards of a list differ in height) that
    // takes half the height or more, searched in every container of the scroll area.
    const signature = (element: Element): string => {
      const box = element.getBoundingClientRect();
      return `${element.tagName}|${String(element.className)}|${String(Math.round(box.width / 8))}`;
    };
    const total = scroller === root ? document.documentElement.scrollHeight : scroller.scrollHeight;
    for (const container of Array.from(scroller.querySelectorAll<HTMLElement>('*'))) {
      if (container.children.length < 4) continue;
      const groups = new Map<string, { count: number; height: number }>();
      for (const child of Array.from(container.children)) {
        const key = signature(child);
        const group = groups.get(key) ?? { count: 0, height: 0 };
        group.count += 1;
        group.height += child.getBoundingClientRect().height;
        groups.set(key, group);
      }
      for (const group of groups.values()) {
        if (group.count >= 4 && group.height >= 0.5 * total) isList = true;
      }
      if (isList) break;
    }
  }
  return {
    coverage: filled / (cols * rows),
    maxEmptyBand: longestRun / rows,
    bottomGap: 1 - lastInkRow / rows,
    scrolls: scroller !== null,
    overflowPx,
    isList,
  };
}

/** What a screen's numbers say against the rule, in words for the report; empty when it passes. */
export function densityFindings(density: ScreenDensity, device: 'phone' | 'tablet'): string[] {
  const floor = DENSITY_FLOOR[device];
  const findings: string[] = [];
  if (density.scrolls && !density.isList) {
    findings.push(`scrolls ${String(Math.round(density.overflowPx))} px without being a list`);
  }
  if (!density.scrolls && density.coverage < floor.coverage) {
    findings.push(`first screen ${(density.coverage * 100).toFixed(0)} % filled`);
  }
  if (density.maxEmptyBand > floor.maxEmptyBand) {
    findings.push(`empty band ${(density.maxEmptyBand * 100).toFixed(0)} % of the screen`);
  }
  return findings;
}
