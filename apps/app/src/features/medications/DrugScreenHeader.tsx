import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { ItemBookmarkMenu } from '@/features/collections/ItemBookmarkMenu';
import type { ReaderBookmark } from '@/features/collections/ReaderItemActions';
import type { DrugHeaderModel } from '@/features/medications/drug-screen';
import {
  type ResolvedMedicationPackagingImage,
  resolveMedicationPackagingImage,
} from '@/features/medications/medication-packaging-images';
import { PackagingImageSource } from '@/features/medications/PackagingImageSource';
import type { ItemRefInput } from '@/state/item-collections';

import '@/features/medications/drug-screen.css';

/**
 * The top of a drug document, as small as it can be: the name, the two borderless tools (bookmark,
 * recipe) on the same row, and one line of country, form, strength and manufacturer. Compare and
 * share are items of the reader header's «⋯» menu. A packaging photo, when the installed set has one, shows dimmed behind the text.
 */
export function DrugScreenHeader(props: {
  readonly header: DrugHeaderModel;
  /** The title element: the reader draws it so that «find in document» can mark it. */
  readonly title: JSX.Element;
  readonly bookmarkItem: ItemRefInput;
  readonly bookmark: ReaderBookmark;
  /** Extra borderless tools after the bookmark (the recipe icon). */
  readonly tools?: JSX.Element;
}): JSX.Element {
  const [image, setImage] = createSignal<ResolvedMedicationPackagingImage | null>(null);

  createEffect(() => {
    const reference = props.header.imageReference;
    setImage(null);
    if (!reference) return;
    let stale = false;
    onCleanup(() => {
      stale = true;
    });
    void resolveMedicationPackagingImage(reference).then((resolved) => {
      if (!stale) setImage(resolved);
    });
  });

  return (
    <header class="drug-header" classList={{ 'drug-header--with-image': image() !== null }}>
      <Show when={image()}>
        {(resolved) => (
          <>
            <div class="drug-header__backdrop" aria-hidden="true">
              <img
                class="drug-header__photo"
                src={resolved().url}
                alt=""
                decoding="async"
                onError={() => setImage(null)}
              />
            </div>
            <div class="drug-header__veil" aria-hidden="true" />
            <PackagingImageSource image={resolved()} class="drug-header__image-source" />
          </>
        )}
      </Show>
      <div
        class="drug-header__body"
        classList={{ 'drug-header__body--with-image': image() !== null }}
      >
        <Show when={props.header.kind === 'substance'}>
          <p class="drug-header__kicker">{props.header.kicker}</p>
        </Show>
        <div class="drug-header__row">
          <div class="drug-header__heading">
            <h1 class="drug-header__title">{props.title}</h1>
          </div>
          <div class="drug-header__actions">
            <ItemBookmarkMenu
              class="drug-header__bookmark"
              item={props.bookmarkItem}
              open={props.bookmark.open()}
              onOpenChange={props.bookmark.setOpen}
            />
            {props.tools}
          </div>
        </div>
        <Show when={props.header.latinName || props.header.country || props.header.meta.length > 0}>
          <p class="drug-header__meta">
            <Show when={props.header.latinName}>
              {(latin) => (
                <span class="drug-header__meta-item drug-header__meta-item--latin" lang="la">
                  {latin()}
                </span>
              )}
            </Show>
            <Show when={props.header.country}>
              {(country) => (
                <span class="drug-header__meta-item" title={props.header.countryTitle}>
                  <span class="sr-only">Страна производства: </span>
                  {country()}
                </span>
              )}
            </Show>
            <For each={props.header.meta}>
              {(item) => <span class="drug-header__meta-item">{item}</span>}
            </For>
          </p>
        </Show>
      </div>
    </header>
  );
}
