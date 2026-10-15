import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { DownloadProgressMark } from '@/components/DownloadProgressMark';
import type { SearchScope } from '@/features/search/ScopedMedicalCore';
import type { SectionWaitMark } from '@/features/search/search-section-gate';
import type { SectionOverviewRow } from '@/features/search/sections-overview';

import './search-sections.css';

/**
 * The empty home screen lists what can be searched instead of an endless catalog: each section
 * with how many entries it holds. Choosing one opens its catalog, as the source picker does.
 * While the medical core is not ready the sections that need it stay readable but dimmed, with a
 * small progress mark; a tap on them is answered by the page (`onSelect`) with a notice.
 */
export function SearchSectionsOverview(props: {
  readonly rows: readonly SectionOverviewRow[];
  /** Whether a section waits for the core and cannot open yet. */
  readonly locked: (scope: SearchScope) => boolean;
  /** The mark of the waiting rows: the core's real download share, or a still or turning mark. */
  readonly waitMark: SectionWaitMark;
  readonly onSelect: (scope: SearchScope) => void;
}): JSX.Element {
  return (
    <section class="search-sections" aria-labelledby="search-sections-title">
      <h2 class="search-sections__title" id="search-sections-title">
        Разделы
      </h2>
      <ul class="search-sections__list">
        <For each={props.rows}>
          {(row) => (
            <li
              class="search-sections__item"
              data-tour={row.id === 'medications' ? 'section-medications' : undefined}
            >
              <button
                type="button"
                class="search-sections__row"
                classList={{ 'search-sections__row--locked': props.locked(row.id) }}
                aria-disabled={props.locked(row.id) ? 'true' : undefined}
                onClick={() => props.onSelect(row.id)}
              >
                <span class="search-sections__icon-frame">
                  <AppGlyph name={row.icon} class="search-sections__icon" />
                </span>
                <span class="search-sections__name">{row.label}</span>
                <span
                  class="search-sections__count"
                  classList={{ 'search-sections__count--empty': row.empty }}
                >
                  {row.countLabel}
                </span>
                <Show
                  when={props.locked(row.id)}
                  fallback={<AppGlyph name="caret-right" class="search-sections__caret" />}
                >
                  <DownloadProgressMark
                    class="search-sections__wait-mark"
                    state={props.waitMark.state}
                    progress={props.waitMark.progress}
                    busy={props.waitMark.busy}
                  />
                </Show>
              </button>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}
