import { createEffect, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { SearchField } from '@/components/SearchField';

const HIGHLIGHT_NAME = 'note-text-search';
const ACTIVE_NAME = 'note-text-search-active';

interface HighlightRegistryLike {
  set(name: string, highlight: Highlight): void;
  delete(name: string): void;
}

function highlightRegistry(): HighlightRegistryLike | undefined {
  return window.CSS?.highlights as unknown as HighlightRegistryLike | undefined;
}

interface SearchMatch {
  readonly range: Range;
}

function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const text = current as Text;
    if (text.data.trim().length > 0) nodes.push(text);
    current = walker.nextNode();
  }
  return nodes;
}

function findRanges(root: HTMLElement, query: string): SearchMatch[] {
  const lowered = query.toLocaleLowerCase('ru-RU');
  if (!lowered) return [];
  const ranges: SearchMatch[] = [];
  for (const node of collectTextNodes(root)) {
    const text = node.data.toLocaleLowerCase('ru-RU');
    let from = text.indexOf(lowered);
    while (from >= 0) {
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, from + lowered.length);
      ranges.push({ range });
      from = text.indexOf(lowered, from + lowered.length);
    }
  }
  return ranges;
}

/**
 * In-note text search built on CSS Custom Highlights: matches are painted
 * without touching the ProseMirror DOM, so undo history stays clean.
 */
export function NoteTextSearch(props: {
  readonly surface: () => HTMLElement | undefined;
  readonly onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [matches, setMatches] = createSignal<readonly SearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = createSignal(-1);
  let searchInput: HTMLInputElement | undefined;

  onMount(() => {
    searchInput?.focus({ preventScroll: true });
  });

  createEffect(() => {
    const surface = props.surface();
    const term = query().trim();
    if (!surface || !term) {
      setMatches([]);
      setActiveIndex(-1);
      highlightRegistry()?.delete(HIGHLIGHT_NAME);
      highlightRegistry()?.delete(ACTIVE_NAME);
      return;
    }
    const found = findRanges(surface, term);
    setMatches(found);
    setActiveIndex(found.length > 0 ? 0 : -1);
  });

  createEffect(() => {
    const list = matches();
    const active = activeIndex();
    const highlights = highlightRegistry();
    if (!highlights) return;
    if (list.length === 0) {
      highlights.delete(HIGHLIGHT_NAME);
      highlights.delete(ACTIVE_NAME);
      return;
    }
    highlights.set(HIGHLIGHT_NAME, new Highlight(...list.map((item) => item.range)));
    const current = list[active];
    highlights.set(ACTIVE_NAME, current ? new Highlight(current.range) : new Highlight());
  });

  const scrollToActive = (): void => {
    const current = matches()[activeIndex()];
    current?.range.startContainer.parentElement?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    });
  };

  const step = (delta: number): void => {
    const total = matches().length;
    if (total === 0) return;
    setActiveIndex((index) => (index + delta + total) % total);
    requestAnimationFrame(scrollToActive);
  };

  const countLabel = (): string =>
    matches().length > 0 ? `${activeIndex() + 1}/${matches().length}` : '0/0';

  onCleanup(() => {
    highlightRegistry()?.delete(HIGHLIGHT_NAME);
    highlightRegistry()?.delete(ACTIVE_NAME);
  });

  return (
    <search class="note-text-search note-text-search--open" aria-label="Поиск по заметке">
      <SearchField
        class="note-text-search__field"
        value={query()}
        onInput={setQuery}
        placeholder="Поиск в заметке"
        label="Поиск по заметке"
        hideLabel
        inputRef={(element) => {
          searchInput = element;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') step(event.shiftKey ? -1 : 1);
          if (event.key === 'Escape') props.onClose();
        }}
        leading={
          <span
            class="note-text-search__field-status"
            role="status"
            aria-live="polite"
            aria-label={countLabel() === '0/0' ? 'Нет совпадений' : countLabel()}
          >
            {countLabel()}
          </span>
        }
      />
      <button
        type="button"
        class="note-text-search__button"
        aria-label="Предыдущее совпадение"
        onClick={() => step(-1)}
      >
        <AppGlyph name="caret-up" class="note-text-search__icon" />
      </button>
      <button
        type="button"
        class="note-text-search__button"
        aria-label="Следующее совпадение"
        onClick={() => step(1)}
      >
        <AppGlyph name="caret-down" class="note-text-search__icon" />
      </button>
    </search>
  );
}

export function hasHighlightSupport(): boolean {
  return typeof window !== 'undefined' && Boolean(window.CSS?.highlights);
}

export const NoteSearchToggle = (props: { readonly onToggle: () => void }): JSX.Element => (
  <Show when={hasHighlightSupport()}>
    <button
      type="button"
      class="note-text-search__toggle"
      aria-label="Искать в заметке"
      title="Поиск в заметке"
      onClick={props.onToggle}
    >
      <AppGlyph name="search" class="note-text-search__icon" />
    </button>
  </Show>
);
