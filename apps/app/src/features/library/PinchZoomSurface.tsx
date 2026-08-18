import type { JSX } from 'solid-js';

import { usePinchZoom } from '@/features/library/use-pinch-zoom';

export function PinchZoomSurface(props: {
  readonly class?: string;
  readonly contentClass?: string;
  readonly children: JSX.Element;
}): JSX.Element {
  const pinch = usePinchZoom();
  return (
    <div ref={pinch.ref} class={props.class ?? 'pinch-zoom-surface'}>
      <div ref={pinch.contentRef} class={props.contentClass ?? 'pinch-zoom-surface__content'}>
        {props.children}
      </div>
    </div>
  );
}
