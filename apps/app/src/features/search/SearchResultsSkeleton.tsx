import { For, type JSX } from 'solid-js';
import { ListGroup, ListRow } from '@/components/ListRow';
import '@/features/search/search-results-skeleton.css';

const ROWS = [0, 1, 2, 3] as const;

/** The compact results list and the skeleton share the same layout. */
export function SearchResultsSkeleton(props: { readonly leaving: boolean }): JSX.Element {
  return (
    <div
      class="results-skeleton"
      classList={{ 'results-skeleton--leaving': props.leaving }}
      role="status"
      aria-label="Загружаем результаты поиска"
      data-testid="search-skeleton"
    >
      <div aria-hidden="true" class="results-skeleton__list">
        <ListGroup>
          <For each={ROWS}>
            {() => (
              <ListRow
                class="results-skeleton__group"
                leading={<span class="results-skeleton__tile" />}
                title={<span class="results-skeleton__bar results-skeleton__bar--title" />}
                subtitle={<span class="results-skeleton__bar results-skeleton__bar--subtitle" />}
              />
            )}
          </For>
        </ListGroup>
      </div>
    </div>
  );
}
