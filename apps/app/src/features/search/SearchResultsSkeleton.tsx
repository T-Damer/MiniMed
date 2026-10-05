import { For, type JSX } from 'solid-js';
import { skeletonCardCount, skeletonColumnCount } from '@/features/search/search-skeleton';
import '@/features/search/search-results-skeleton.css';

const CARD_INDEXES = (count: number): readonly number[] =>
  Array.from({ length: count }, (_, index) => index);

/**
 * Placeholder for the result groups: the same card, header, tags row and excerpt rows as
 * `SearchResultGroupCard`, drawn as quiet bars. It sits in the results slot, so it never moves.
 */
export function SearchResultsSkeleton(props: { readonly leaving: boolean }): JSX.Element {
  const columns = skeletonColumnCount(window.innerWidth);
  return (
    <div
      class="results-skeleton"
      classList={{ 'results-skeleton--leaving': props.leaving }}
      role="status"
      aria-label="Загружаем результаты поиска"
      data-testid="search-skeleton"
    >
      <div class="layout-card-grid results-skeleton__grid" style={{ '--layout-cols': columns }}>
        <For each={CARD_INDEXES(skeletonCardCount(columns))}>
          {(index) => (
            <section class="result-group results-skeleton__group" aria-hidden="true">
              <div class="result-group-header results-skeleton__header">
                <span class="result-group-header__index">{String(index + 1).padStart(2, '0')}</span>
                <span class="result-group-header__body">
                  <span class="results-skeleton__bar results-skeleton__bar--kind" />
                  <span class="results-skeleton__bar results-skeleton__bar--meta" />
                  <span class="results-skeleton__bar results-skeleton__bar--title" />
                  <span class="results-skeleton__tags">
                    <span class="results-skeleton__tag" />
                    <span class="results-skeleton__tag" />
                  </span>
                  <span class="results-skeleton__bar results-skeleton__bar--note" />
                </span>
              </div>
              <div class="result-group__snippets">
                <div class="result-card results-skeleton__card">
                  <span class="results-skeleton__category">
                    <span class="results-skeleton__category-icon" />
                    <span class="results-skeleton__bar results-skeleton__bar--stamp" />
                  </span>
                  <span class="results-skeleton__bar results-skeleton__bar--line results-skeleton__bar--first" />
                  <span class="results-skeleton__bar results-skeleton__bar--line" />
                  <span class="results-skeleton__bar results-skeleton__bar--line results-skeleton__bar--last" />
                </div>
              </div>
            </section>
          )}
        </For>
      </div>
    </div>
  );
}
