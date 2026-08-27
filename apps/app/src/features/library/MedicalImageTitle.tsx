import { createSignal, type JSX, onCleanup, onMount } from 'solid-js';

export function MedicalImageTitle(props: { readonly title: string }): JSX.Element {
  const [overflowDistance, setOverflowDistance] = createSignal(0);
  let title: HTMLElement | undefined;
  let titleText: HTMLSpanElement | undefined;

  onMount(() => {
    if (!title || !titleText) return;
    const measure = (): void => {
      setOverflowDistance(Math.max(0, Math.ceil(titleText.scrollWidth - title.clientWidth)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(title);
    observer.observe(titleText);
    const frame = requestAnimationFrame(measure);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    });
  });

  return (
    <strong class="medical-image-viewer__title" title={props.title} ref={title}>
      <span
        class="medical-image-viewer__title-text"
        classList={{ 'medical-image-viewer__title-text--marquee': overflowDistance() > 1 }}
        style={{ '--medical-image-title-shift': `${String(overflowDistance())}px` }}
        ref={titleText}
      >
        {props.title}
      </span>
    </strong>
  );
}
