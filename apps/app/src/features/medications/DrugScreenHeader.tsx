import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { ItemBookmarkMenu } from '@/features/collections/ItemBookmarkMenu';
import type { ReaderBookmark } from '@/features/collections/ReaderItemActions';
import type { DrugHeaderModel } from '@/features/medications/drug-screen';
import {
  ALLMED_SOURCE_URL,
  type ResolvedMedicationPackagingImage,
  resolveMedicationPackagingImage,
} from '@/features/medications/medication-packaging-images';
import type { ItemRefInput } from '@/state/item-collections';

import '@/features/medications/drug-screen.css';

/**
 * The top of a drug document: the trade name (or the substance) with its Latin name, form and
 * manufacturer, bookmark and share. A packaging photo, when the installed set has one, sits dimmed
 * behind the text; without one the header is a calm paper panel.
 */
export function DrugScreenHeader(props: {
  readonly header: DrugHeaderModel;
  /** The title element: the reader draws it so that «find in document» can mark it. */
  readonly title: JSX.Element;
  readonly bookmarkItem: ItemRefInput;
  readonly bookmark: ReaderBookmark;
  readonly onShare: () => void;
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
          </>
        )}
      </Show>
      <div
        class="drug-header__body"
        classList={{ 'drug-header__body--with-image': image() !== null }}
      >
        <div class="drug-header__top">
          <p class="drug-header__kicker">{props.header.kicker}</p>
          <div class="drug-header__actions">
            <ItemBookmarkMenu
              class="drug-header__bookmark"
              item={props.bookmarkItem}
              open={props.bookmark.open()}
              onOpenChange={props.bookmark.setOpen}
            />
            <button
              type="button"
              class="drug-header__share"
              aria-label={`Поделиться: ${props.header.title}`}
              title="Поделиться"
              onClick={props.onShare}
            >
              <AppGlyph name="share" class="drug-header__share-icon" />
            </button>
          </div>
        </div>
        <h1 class="drug-header__title">{props.title}</h1>
        <Show when={props.header.latinName}>
          {(latin) => (
            <p class="drug-header__latin" lang="la">
              {latin()}
            </p>
          )}
        </Show>
        <Show when={props.header.meta.length > 0}>
          <p class="drug-header__meta">
            <For each={props.header.meta}>
              {(item) => <span class="drug-header__meta-item">{item}</span>}
            </For>
          </p>
        </Show>
        <Show when={image()}>
          <p class="drug-header__credit">
            Фото упаковки:{' '}
            <a
              class="drug-header__credit-link"
              href={ALLMED_SOURCE_URL}
              rel="noreferrer"
              target="_blank"
            >
              Allmed
            </a>
          </p>
        </Show>
      </div>
    </header>
  );
}
