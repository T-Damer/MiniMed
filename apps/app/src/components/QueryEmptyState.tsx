import type { JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

export function QueryEmptyState(props: { readonly message?: string }): JSX.Element {
  return (
    <div class="search-empty-state paper-card" role="status">
      <AppGlyph name="binoculars" class="search-empty-state__icon" />
      <p class="search-empty-state__text">
        {props.message ?? 'По этому запросу ничего не найдено.'}
      </p>
    </div>
  );
}
