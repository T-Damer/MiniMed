export interface FlipOptions {
  /** Elements whose position should animate between layouts. */
  readonly selector: string;
  readonly durationMs?: number;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * FLIP animation for structural layout changes (First–Last–Invert–Play):
 * the DOM mutates immediately — text reflows exactly once at its final
 * position — and the moved elements then slide there via transform, so no
 * per-frame reflow and no scaled/blurred text. Same idea as motion's
 * `<motion.div layout>` / `layout="position"`, without React.
 *
 * The returned runner measures right before each mutation, so it can be
 * reused for repeated toggles.
 */
export function createFlipAnimator(
  root: HTMLElement,
  options: FlipOptions,
): (mutate: () => void) => void {
  const duration = options.durationMs ?? 220;
  let raf = 0;

  return (mutate: () => void): void => {
    if (prefersReducedMotion()) {
      mutate();
      return;
    }

    const first = new Map<Element, DOMRect>();
    for (const element of Array.from(root.querySelectorAll(options.selector))) {
      first.set(element, element.getBoundingClientRect());
    }

    mutate();

    const moved: Array<{ element: HTMLElement; dx: number; dy: number }> = [];
    let area = 0;
    for (const element of Array.from(root.querySelectorAll<HTMLElement>(options.selector))) {
      const before = first.get(element);
      if (!before) continue;
      const after = element.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      area += after.width * after.height;
      moved.push({ element, dx, dy });
    }
    if (moved.length === 0) return;
    // Sliding a gigantic layer (huge books) costs more than it is worth —
    // prefer an instant snap over a janky composite.
    if (area > 12_000_000) {
      for (const item of moved) item.element.style.removeProperty('transition');
      return;
    }
    for (const item of moved) {
      item.element.style.transition = 'none';
      item.element.style.transform = `translate(${item.dx}px, ${item.dy}px)`;
    }

    void root.offsetWidth;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      for (const item of moved) {
        item.element.style.transition = `transform ${duration}ms ease-out`;
        item.element.style.transform = '';
      }
      window.setTimeout(() => {
        for (const item of moved) item.element.style.removeProperty('transition');
      }, duration + 40);
    });
  };
}
