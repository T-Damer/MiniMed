import { createEffect, type JSX, onCleanup, Show } from 'solid-js';

import { type PinchZoomControls, usePinchZoom } from '@/features/library/use-pinch-zoom';

export function PinchZoomSurface(props: {
  readonly class?: string;
  readonly contentClass?: string;
  readonly lightbox?: boolean;
  readonly pinch?: PinchZoomControls;
  readonly children: JSX.Element;
}): JSX.Element {
  const fallback = usePinchZoom();
  const controls = (): PinchZoomControls => props.pinch ?? fallback;

  createEffect(() => {
    if (!props.lightbox || controls().scale() <= 1) return;
    const handleScroll = (): void => {
      controls().reset({ animated: true });
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    onCleanup(() => window.removeEventListener('scroll', handleScroll));
  });

  return (
    <div
      ref={(element) => controls().ref(element)}
      class={props.class ?? 'pinch-zoom-surface'}
      classList={{ 'pinch-zoom-surface--zoomed': controls().scale() > 1 }}
    >
      <Show when={props.lightbox && controls().scale() > 1}>
        <button
          type="button"
          class="pinch-zoom-surface__dim"
          aria-label="Сбросить масштаб"
          onClick={() => controls().reset({ animated: true })}
        />
      </Show>
      <div
        ref={(element) => controls().contentRef(element)}
        class={props.contentClass ?? 'pinch-zoom-surface__content'}
        classList={{ 'pinch-zoom-surface__content--zoomed': controls().scale() > 1 }}
      >
        {props.children}
      </div>
    </div>
  );
}
