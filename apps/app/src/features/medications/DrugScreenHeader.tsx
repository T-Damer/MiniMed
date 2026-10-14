import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { ItemBookmarkMenu } from '@/features/collections/ItemBookmarkMenu';
import type { ReaderBookmark } from '@/features/collections/ReaderItemActions';
import type { DrugCompareLink, DrugHeaderModel } from '@/features/medications/drug-screen';
import {
  type ResolvedMedicationPackagingImage,
  resolveMedicationPackagingImage,
} from '@/features/medications/medication-packaging-images';
import { PackagingImageSource } from '@/features/medications/PackagingImageSource';
import { notesDrugComparisonPath } from '@/features/notes/notes-routing';
import type { ItemRefInput } from '@/state/item-collections';

import '@/features/medications/drug-screen.css';

/**
 * The top of a drug document, as small as it can be: the name with its country, the round tools
 * (bookmark, recipe, compare, share) on the same row, and one line of form, strength and
 * manufacturer. A packaging photo, when the installed set has one, shows dimmed behind the text.
 */
export function DrugScreenHeader(props: {
  readonly header: DrugHeaderModel;
  /** The title element: the reader draws it so that «find in document» can mark it. */
  readonly title: JSX.Element;
  readonly bookmarkItem: ItemRefInput;
  readonly bookmark: ReaderBookmark;
  readonly onShare: () => void;
  /** Where «compare with…» starts from; none when the drug has no ЕСКЛП card. */
  readonly compare?: DrugCompareLink | null | undefined;
  /** Extra round tools before the compare and share buttons (the recipe icon). */
  readonly toolsBefore?: JSX.Element;
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
            {props.toolsBefore}
            <Show when={props.compare}>
              {(compare) => (
                <a
                  class="drug-header__tool"
                  href={notesDrugComparisonPath(
                    [],
                    [compare().product ? `${compare().slug}|${compare().product}` : compare().slug],
                  )}
                  aria-label={`Сравнить с другим препаратом: ${props.header.title}`}
                  title="Сравнить с…"
                  data-testid="drug-compare-link"
                >
                  <AppGlyph name="text-columns" class="drug-header__tool-icon" />
                </a>
              )}
            </Show>
            <button
              type="button"
              class="drug-header__tool"
              aria-label={`Поделиться: ${props.header.title}`}
              title="Поделиться"
              onClick={props.onShare}
            >
              <AppGlyph name="share" class="drug-header__tool-icon" />
            </button>
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
