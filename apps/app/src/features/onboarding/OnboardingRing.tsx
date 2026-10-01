import type { JSX } from 'solid-js';

import { growRect, type Rect } from './onboarding-geometry';

/** Space between the control and its highlight ring. */
const RING_PAD = 6;

/** A soft ring around the control a step explains. */
export function OnboardingRing(props: {
  readonly rect: Rect;
  readonly radius: number;
}): JSX.Element {
  const box = () => growRect(props.rect, RING_PAD);
  return (
    <div
      class="onboarding-ring"
      aria-hidden="true"
      style={{
        transform: `translate3d(${box().left}px, ${box().top}px, 0)`,
        width: `${box().width}px`,
        height: `${box().height}px`,
        'border-radius': `${props.radius + RING_PAD}px`,
      }}
    />
  );
}
