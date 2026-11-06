import type { MedicalDocumentSummary } from '@localmed/contracts';
import { createMemo, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { ChoiceChip, ChoiceChipList } from '@/components/ChoiceChip';
import { displayDocumentTitle } from '@/features/library/document-display';
import { sameTitleDocuments } from '@/features/library/same-title-documents';
import { searchResultDocumentKind } from '@/features/search/ScopedMedicalCore';
import { RESULT_KIND_VISUALS } from '@/features/search/searchResultKindVisuals';
import { openDocumentOverlay } from '@/state/document-navigation';

import './same-title-documents.css';

/**
 * «Другие» under the title: the other documents of the same name (a recommendation, a reference
 * article, a definition), each a chip with its kind, as search offers them for an ambiguous name.
 */
export function SameTitleDocuments(props: {
  readonly document: MedicalDocumentSummary;
  readonly documents: readonly MedicalDocumentSummary[];
}): JSX.Element {
  const others = createMemo(() => sameTitleDocuments(props.documents, props.document));
  return (
    <Show when={others().length > 0}>
      <nav class="same-title-documents" aria-label="Другие документы с этим названием">
        <span class="same-title-documents__label">Другие</span>
        <ChoiceChipList class="same-title-documents__list" label="Другие документы">
          <For each={others()}>
            {(other) => {
              const visual = RESULT_KIND_VISUALS[searchResultDocumentKind(other)];
              return (
                <ChoiceChip
                  compact
                  icon={<AppGlyph name={visual.icon} class="choice-chip__glyph" />}
                  detail={visual.label}
                  onClick={() => openDocumentOverlay(other.id)}
                >
                  {displayDocumentTitle(other)}
                </ChoiceChip>
              );
            }}
          </For>
        </ChoiceChipList>
      </nav>
    </Show>
  );
}
