import { createEffect, createSignal, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { PreviewableImage } from '@/features/library/document-rich-block';
import type { ResolvedReferenceImage } from '@/features/library/reference-image-assets';

import './reader-hero.css';

/**
 * The top of an illustrated reference article: its picture, sharp and whole (the way a drug page
 * shows its packaging), above the title; a soft blur of the same picture only fills the card around
 * it. A tap opens the picture full screen. The hero holds its place while the picture is looked up,
 * so the title does not jump when it arrives; an article without a picture simply shows its title.
 * `onSource` reports the picture's source address so the text can leave out the copy of the same
 * picture it carries inline.
 */
export interface HeroPicture {
  /** Identity of the picture; a new key looks the picture up again. */
  readonly key: string;
  readonly resolve: () => Promise<ResolvedReferenceImage | null>;
  /** The credit line under the title, e.g. «Фото: Красота и медицина». */
  readonly credit: string;
  /**
   * `paper`: the picture lies on a paper sheet and its white ground takes the sheet's tone (old
   * botanical plates in the herbal book); by default it is a photo with its own frame.
   */
  readonly surface?: 'photo' | 'paper';
}

export function ReaderHero(props: {
  /** The picture of the article; no hero without it. */
  readonly picture: HeroPicture | undefined;
  readonly onSource?: (source: string | null) => void;
  readonly children: JSX.Element;
}): JSX.Element {
  const [image, setImage] = createSignal<ResolvedReferenceImage | null>(null);
  const [pending, setPending] = createSignal(false);

  createEffect(() => {
    const picture = props.picture;
    setImage(null);
    props.onSource?.(null);
    if (!picture) {
      setPending(false);
      return;
    }
    setPending(true);
    let stale = false;
    onCleanup(() => {
      stale = true;
      props.onSource?.(null);
    });
    void picture
      .resolve()
      .then((resolved) => {
        if (stale) return;
        setImage(resolved);
        props.onSource?.(resolved?.sourceUrl ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!stale) setPending(false);
      });
  });

  return (
    <Show when={props.picture} fallback={props.children}>
      <div
        class="reader-hero"
        classList={{
          'reader-hero--image': image() !== null,
          'reader-hero--pending': pending(),
        }}
      >
        <Show when={image()}>
          {(resolved) => (
            <>
              <img class="reader-hero__backdrop" src={resolved().url} alt="" aria-hidden="true" />
              <div class="reader-hero__veil" aria-hidden="true" />
            </>
          )}
        </Show>
        <div
          class="reader-hero__stage"
          classList={{ 'reader-hero__stage--shown': pending() || image() !== null }}
        >
          <Show when={image()}>
            {(resolved) => (
              <>
                <PreviewableImage
                  openClass={
                    props.picture?.surface === 'paper'
                      ? 'reader-hero__open reader-hero__open--paper'
                      : 'reader-hero__open'
                  }
                  imageClass={
                    props.picture?.surface === 'paper'
                      ? 'reader-hero__photo reader-hero__photo--paper'
                      : 'reader-hero__photo'
                  }
                  src={resolved().url}
                  alt={resolved().alt}
                  caption={resolved().alt}
                  onError={() => {
                    setImage(null);
                    props.onSource?.(null);
                  }}
                />
                <AppGlyph name="arrows-out" class="reader-hero__expand" />
              </>
            )}
          </Show>
        </div>
        <div class="reader-hero__body">
          {props.children}
          <Show when={image()}>
            {(resolved) => (
              <a
                class="reader-hero__credit"
                href={resolved().sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                {props.picture?.credit}
              </a>
            )}
          </Show>
        </div>
      </div>
    </Show>
  );
}
