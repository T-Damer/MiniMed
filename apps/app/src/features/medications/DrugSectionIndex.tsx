import { For, type JSX } from 'solid-js';

import type { DrugSectionIndexItem } from '@/features/medications/drug-screen';

import '@/features/medications/drug-screen.css';

/** Jump links to the document's top-level sections, above the full text. */
export function DrugSectionIndex(props: {
  readonly items: readonly DrugSectionIndexItem[];
  readonly activeAnchor?: string | null;
  readonly onSelect: (anchor: string) => void;
}): JSX.Element {
  return (
    <nav class="drug-section-index" aria-label="Разделы документа">
      <ul class="drug-section-index__list">
        <For each={props.items}>
          {(item) => (
            <li class="drug-section-index__item">
              <button
                type="button"
                class="drug-section-index__link"
                classList={{
                  'drug-section-index__link--active': props.activeAnchor === item.anchor,
                }}
                aria-current={props.activeAnchor === item.anchor ? 'location' : undefined}
                onClick={() => props.onSelect(item.anchor)}
              >
                <span class="drug-section-index__number">{item.number}</span>
                <span class="drug-section-index__label">{item.label}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </nav>
  );
}
