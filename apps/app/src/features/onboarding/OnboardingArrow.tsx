import { createMemo, type JSX } from 'solid-js';

import { arrowGeometry, type Point } from './onboarding-geometry';

/**
 * A hand-drawn looking arrow, drawn in with stroke-dashoffset when it first appears. The path is
 * recomputed as the card or the control moves; the drawing animation does not restart.
 */
export function OnboardingArrow(props: {
  readonly from: Point;
  readonly to: Point;
  /** Varies the bow and the wobble between steps. */
  readonly seed: number;
  /** Milliseconds to wait before drawing, so it starts once the card has settled. */
  readonly delayMs?: number;
}): JSX.Element {
  const geometry = createMemo(() => arrowGeometry(props.from, props.to, props.seed));
  return (
    <svg
      class="onboarding-arrow"
      aria-hidden="true"
      style={{ '--onboarding-arrow-delay': `${props.delayMs ?? 0}ms` }}
    >
      <path class="onboarding-arrow__shaft" d={geometry().d} pathLength="1" />
      <path class="onboarding-arrow__head" d={geometry().head} pathLength="1" />
    </svg>
  );
}
