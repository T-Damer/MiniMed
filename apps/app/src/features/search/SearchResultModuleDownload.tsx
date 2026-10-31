import type { ContentModuleCatalogEntry, MedicalDocumentSummary } from '@localmed/contracts';
import { createEffect, createMemo, createSignal, type JSX, Show } from 'solid-js';
import { SearchDownloadChip } from '@/features/search/SearchDownloadChip';
import { pointerModuleOf } from '@/features/search/search-pack-offers';
import type { SearchSectionDownloads } from '@/features/search/useSearchSectionDownloads';

/**
 * A source pointer only proves that a full document exists in a published module; offer that exact
 * module (verified target membership) right in the result instead of naming its internal id: a
 * round download button in the card's header, on every card of that pack (one download however
 * many cards offer it).
 */
export function SearchResultModuleDownload(props: {
  readonly document: MedicalDocumentSummary | undefined;
  readonly downloads: SearchSectionDownloads;
}): JSX.Element {
  const pointerModule = createMemo(() =>
    pointerModuleOf(props.document, props.downloads.catalog()),
  );
  // Installing replaces the pointer by the real document, and the offer would vanish with it
  // before its button could say «Готово»: the pack stays known to this card.
  const [kept, setKept] = createSignal<ContentModuleCatalogEntry | null>(null);
  createEffect(() => {
    const current = pointerModule();
    if (current) setKept(current);
  });
  const module = () => pointerModule() ?? kept();
  return (
    <Show when={module()}>
      {(target) => (
        <div class="result-group__action">
          <SearchDownloadChip
            label="Скачать полный текст"
            subject={target().title}
            modules={[target()]}
            downloads={props.downloads}
            iconOnly
          />
        </div>
      )}
    </Show>
  );
}
