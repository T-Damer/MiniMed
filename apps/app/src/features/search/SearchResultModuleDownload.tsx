import type { ContentModuleCatalogEntry, MedicalDocumentSummary } from '@localmed/contracts';
import { createEffect, createMemo, createSignal, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { SearchDownloadChip } from '@/features/search/SearchDownloadChip';
import { pointerModuleOf } from '@/features/search/search-pack-offers';
import type { SearchSectionDownloads } from '@/features/search/useSearchSectionDownloads';

/**
 * A source pointer only proves that a full document exists in a published module; offer that exact
 * module (verified target membership) right in the result instead of naming its internal id.
 * Many results of one list usually live in one pack: only the first of them carries the download
 * chip (`offerOwners`), the others show a quiet note that the same pack is offered above.
 */
export function SearchResultModuleDownload(props: {
  readonly document: MedicalDocumentSummary | undefined;
  readonly downloads: SearchSectionDownloads;
  /** Module id → the result that carries its download chip. */
  readonly offerOwners: ReadonlyMap<string, string>;
}): JSX.Element {
  const pointerModule = createMemo(() =>
    pointerModuleOf(props.document, props.downloads.catalog()),
  );
  // Installing replaces the pointer by the real document, and the offer would vanish with it
  // before its chip could say «Готово»: the pack stays known to this card.
  const [kept, setKept] = createSignal<ContentModuleCatalogEntry | null>(null);
  createEffect(() => {
    const current = pointerModule();
    if (current) setKept(current);
  });
  const module = () => pointerModule() ?? kept();
  const ownsOffer = () => {
    const target = module();
    const owner = target ? props.offerOwners.get(target.id) : undefined;
    return owner === undefined || owner === props.document?.id;
  };
  return (
    <Show when={module()}>
      {(target) => (
        <div class="result-group__action">
          <Show
            when={ownsOffer()}
            fallback={
              <Show
                when={props.downloads.ready() && !props.downloads.installedIds([target()]).size}
              >
                <span
                  class="search-download-note"
                  title="Полный текст — в том же наборе, который предложен выше"
                >
                  <AppGlyph name="download" class="search-download-note__glyph" />
                  <span>В том же наборе</span>
                </span>
              </Show>
            }
          >
            <SearchDownloadChip
              label="Скачать полный текст"
              subject={target().title}
              modules={[target()]}
              downloads={props.downloads}
              accent
              compact
            />
          </Show>
        </div>
      )}
    </Show>
  );
}
