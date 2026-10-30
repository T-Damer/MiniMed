import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

import { type SkinPhoto, skinPackPhotoUrl } from '@/features/skin/skin-pack';

import '@/styles/skin-pack.css';

/** The object URL of one photo of the pack, once `enabled` (the photo is near the screen). */
export function createSkinPhotoUrl(
  file: Accessor<string>,
  enabled: Accessor<boolean> = () => true,
): Accessor<string | undefined> {
  const [url, setUrl] = createSignal<string>();
  createEffect(() => {
    if (!enabled()) return;
    const wanted = file();
    void skinPackPhotoUrl(wanted).then((resolved) => {
      if (wanted === file()) setUrl(resolved);
    });
  });
  return url;
}

/**
 * One reference photo of the installed skin pack. It reads the photo from the pack's cache only
 * once it is near the screen, and its box has the photo's own proportions from the first frame, so
 * a gallery never jumps while pictures arrive. `natural` keeps the proportions in the box (a gallery
 * photo); without it the box is the caller's (a square tile) and the photo fills it.
 */
export function SkinPhotoImage(props: {
  readonly photo: SkinPhoto;
  readonly alt: string;
  readonly class?: string;
  readonly natural?: boolean;
}): JSX.Element {
  let box: HTMLSpanElement | undefined;
  const [near, setNear] = createSignal(typeof IntersectionObserver === 'undefined');
  const [loaded, setLoaded] = createSignal(false);
  onMount(() => {
    if (near() || !box) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px' },
    );
    observer.observe(box);
    onCleanup(() => observer.disconnect());
  });
  const url = createSkinPhotoUrl(() => props.photo.file, near);
  return (
    <span
      ref={box}
      class={`skin-photo-img ${props.class ?? ''}`.trim()}
      classList={{ 'skin-photo-img--natural': props.natural === true }}
      style={
        props.natural ? { 'aspect-ratio': `${props.photo.width} / ${props.photo.height}` } : {}
      }
    >
      <Show when={url()}>
        {(src) => (
          <img
            class="skin-photo-img__image"
            classList={{ 'skin-photo-img__image--loaded': loaded() }}
            src={src()}
            alt={props.alt}
            width={props.photo.width}
            height={props.photo.height}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
          />
        )}
      </Show>
    </span>
  );
}
