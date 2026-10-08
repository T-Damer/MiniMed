import { createEffect, createSignal, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { PreviewableImage } from '@/features/library/document-rich-block';
import {
  getReferenceImageResolver,
  type ResolvedReferenceImage,
} from '@/features/library/reference-image-assets';

import './reader-hero.css';

/**
 * The top of an illustrated reference article: its picture, sharp and whole (the way a drug page
 * shows its packaging), above the title; a soft blur of the same picture only fills the card around
 * it. A tap opens the picture full screen. The hero holds its place while the picture is looked up,
 * so the title does not jump when it arrives; an article without a picture simply shows its title.
 * `onSource` reports the picture's source address so the text can leave out the copy of the same
 * picture it carries inline.
 */
export function ReaderHero(props: {
  /** The reference-image document the picture belongs to; no hero without it. */
  readonly imageDocumentId: string | undefined;
  readonly onSource?: (source: string | null) => void;
  readonly children: JSX.Element;
}): JSX.Element {
  const [image, setImage] = createSignal<ResolvedReferenceImage | null>(null);
  const [pending, setPending] = createSignal(false);

  createEffect(() => {
    const documentId = props.imageDocumentId;
    setImage(null);
    props.onSource?.(null);
    if (!documentId) {
      setPending(false);
      return;
    }
    setPending(true);
    let stale = false;
    onCleanup(() => {
      stale = true;
      props.onSource?.(null);
    });
    void getReferenceImageResolver()
      .resolveFirst(documentId)
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
    <Show when={props.imageDocumentId} fallback={props.children}>
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
                  openClass="reader-hero__open"
                  imageClass="reader-hero__photo"
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
                Фото: Красота и медицина
              </a>
            )}
          </Show>
        </div>
      </div>
    </Show>
  );
}
