import type { SearchResultGroup } from '@localmed/contracts';
import { For, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { LayoutVirtualizedGrid } from '@/components/LayoutVirtualizedGrid';
import { SearchResultGroupCard } from '@/features/search/SearchResultGroupCard';
import {
  type ScopeFallbackResult,
  scopeMissLine,
  scopeResultsHeading,
} from '@/features/search/search-scope-fallback';
import '@/features/search/search-scope-fallback.css';

/**
 * The results list of a search whose section found nothing (roadmap item 23): one line saying so,
 * then the hits of the other sections under a subheader each. A subheader of a section opens it.
 */
export function SearchScopeFallbackList(props: {
  readonly fallback: ScopeFallbackResult;
  readonly selectedChunkId: string | undefined;
  readonly action: (group: SearchResultGroup) => JSX.Element;
  readonly qualifier: (group: SearchResultGroup) => string | undefined;
  readonly onOpenDocument: (documentId: string, anchor?: string | null) => void;
  readonly onOpenSection: (
    scope: NonNullable<ScopeFallbackResult['sections'][number]['scope']>,
  ) => void;
}): JSX.Element {
  // The numbers on the cards run on from one section to the next.
  const offsets = () => {
    let total = 0;
    return props.fallback.sections.map((section) => {
      const start = total;
      total += section.groups.length;
      return start;
    });
  };
  return (
    <div class="scope-fallback" data-testid="scope-fallback">
      <p class="scope-fallback__miss" role="status" data-testid="scope-fallback-miss">
        {scopeMissLine(props.fallback.query, props.fallback.missedLabel)}
      </p>
      <For each={props.fallback.sections}>
        {(section, sectionIndex) => (
          <section class="scope-fallback__section" data-testid="scope-fallback-section">
            <h2 class="scope-fallback__heading">
              <Show
                when={section.scope}
                fallback={
                  <span class="scope-fallback__heading-text" data-testid="scope-fallback-heading">
                    {scopeResultsHeading(section.label)}
                  </span>
                }
              >
                {(scope) => (
                  <button
                    type="button"
                    class="scope-fallback__heading-button"
                    data-testid="scope-fallback-heading"
                    onClick={() => props.onOpenSection(scope())}
                  >
                    <span class="scope-fallback__heading-text">
                      {scopeResultsHeading(section.label)}
                    </span>
                    <AppGlyph name="caret-right" class="scope-fallback__heading-icon" />
                  </button>
                )}
              </Show>
            </h2>
            <LayoutVirtualizedGrid data={section.groups} bufferSize={400} align="start">
              {(group, groupIndex) => (
                <SearchResultGroupCard
                  group={group}
                  index={(offsets()[sectionIndex()] ?? 0) + groupIndex}
                  selectedChunkId={props.selectedChunkId}
                  action={props.action(group)}
                  qualifier={props.qualifier(group)}
                  onOpenDocument={props.onOpenDocument}
                />
              )}
            </LayoutVirtualizedGrid>
          </section>
        )}
      </For>
    </div>
  );
}
