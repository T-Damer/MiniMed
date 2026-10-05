import type { JSX } from 'solid-js';

import { growRect, type Rect, RING_PAD } from './onboarding-geometry';

/**
 * A soft ring around the control a step explains. A spotlight ring also dims the rest of the
 * screen a little (its shadow reaches past every edge) and pulses gently.
 */
export function OnboardingRing(props: {
  readonly rect: Rect;
  readonly radius: number;
  readonly spotlight?: boolean;
}): JSX.Element {
  const box = () => growRect(props.rect, RING_PAD);
  return (
    <div
      class="onboarding-ring"
      classList={{ 'onboarding-ring--spotlight': props.spotlight === true }}
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
