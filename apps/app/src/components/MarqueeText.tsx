import { createEffect, createSignal, type JSX, onCleanup, onMount } from 'solid-js';

import '@/components/MarqueeText.css';

/**
 * Single-line text. When it does not fit, it ends in an ellipsis and scrolls back and forth only
 * while `active` (selected, hovered or focused row), so a long list never animates all at once.
 */
export function MarqueeText(props: {
  readonly children: JSX.Element;
  readonly active?: boolean | undefined;
  readonly class?: string;
}) {
  let box: HTMLSpanElement | undefined;
  const [overflow, setOverflow] = createSignal(0);
  // The box's scrollWidth includes inline text overflow, so one observer on the box suffices.
  const measure = (): void => {
    if (box) setOverflow(Math.max(0, Math.ceil(box.scrollWidth - box.clientWidth)));
  };
  onMount(() => {
    if (!box) return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    onCleanup(() => observer.disconnect());
  });
  createEffect(() => {
    if (props.active) measure();
  });
  const running = () => Boolean(props.active) && overflow() > 0;
  return (
    <span
      ref={box}
      class={`marquee-text ${props.class ?? ''}`.trim()}
      classList={{ 'marquee-text--running': running() }}
      style={
        running()
          ? {
              '--marquee-text-distance': `-${overflow()}px`,
              // Constant reading speed: ~40 px/s plus the pauses built into the keyframes.
              '--marquee-text-duration': `${Math.max(4, overflow() / 40 + 3)}s`,
            }
          : undefined
      }
    >
      <span class="marquee-text__track" classList={{ 'marquee-text__track--running': running() }}>
        {props.children}
      </span>
    </span>
  );
}
