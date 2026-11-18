import type { SearchResult } from '@localmed/contracts';
import { createResource, type JSX, Show } from 'solid-js';
import { HighlightedText } from '@/components/HighlightedText';
import {
  displaySectionPath,
  hasExcerptContext,
  presentResultSnippet,
} from '@/features/search/search-result-presentation';
import '@/features/search/search-result-fragment.css';

/** A text hit only mounts its excerpt when the reader asks for it. */
export function SearchResultFragment(props: {
  readonly result: SearchResult;
  readonly source: string;
  readonly loadContext?: ((result: SearchResult) => Promise<string | undefined>) | undefined;
}): JSX.Element {
  const snippet = () => presentResultSnippet(props.result);
  const useful = () => hasExcerptContext(snippet().text, snippet().ranges);
  const [context] = createResource(
    () => (!useful() && props.loadContext ? props.result : false),
    (result) => props.loadContext?.(result),
  );
  const source = () =>
    [props.source, ...displaySectionPath(props.result.sectionPath)]
      .filter((part, index, parts) => part && parts.indexOf(part) === index)
      .join(' · ');
  return (
    <div class="result-fragment">
      <Show when={useful() || context()}>
        <p class="result-fragment__text">
          <Show when={useful()} fallback={context()}>
            <HighlightedText text={snippet().text} ranges={snippet().ranges} />
          </Show>
        </p>
      </Show>
      <p class="result-fragment__source">{source()}</p>
    </div>
  );
}
