import type { ContentModuleCatalogEntry } from '@localmed/contracts';
import { type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { SearchDownloadChip } from '@/features/search/SearchDownloadChip';
import type { SearchSectionDownloads } from '@/features/search/useSearchSectionDownloads';

import './search-icd11-offer.css';

/**
 * The «МКБ-11» section before its pack is installed: one row with the pack's size on the usual
 * download chip. The pack lists no documents in the catalog, so there is nothing to browse yet.
 */
export function SearchIcd11Offer(props: {
  /** The pack the catalog lets the user install now; empty when none is offered. */
  readonly modules: readonly ContentModuleCatalogEntry[];
  /** The pack exists but is a preview one and the Experimental switch is off. */
  readonly experimentalOff: boolean;
  readonly downloads: SearchSectionDownloads;
}): JSX.Element {
  return (
    <section class="search-icd11-offer" aria-label="МКБ-11 не скачана">
      <AppGlyph name="list-dashes" class="search-icd11-offer__icon" />
      <p class="search-icd11-offer__text">
        <Show
          when={props.modules.length > 0 || !props.experimentalOff}
          fallback="Включите Experimental в настройках, чтобы скачать МКБ-11"
        >
          МКБ-11 не скачана
        </Show>
      </p>
      <Show when={props.modules.length > 0}>
        <SearchDownloadChip
          label="Скачать МКБ-11"
          modules={props.modules}
          downloads={props.downloads}
          accent
        />
      </Show>
    </section>
  );
}
