import { createEffect, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { AppGlyph } from '@/components/AppGlyph';
import {
  addUserHighlight,
  loadUserHighlights,
  removeUserHighlight,
  USER_HIGHLIGHTS_EVENT,
  type UserDocumentHighlight,
} from '@/state/user-library-highlights';

const HIGHLIGHT_NAME = 'user-doc-highlights';

interface HighlightRegistryLike {
  set(name: string, highlight: Highlight): void;
  delete(name: string): void;
}

function registry(): HighlightRegistryLike | undefined {
  return window.CSS?.highlights as unknown as HighlightRegistryLike | undefined;
}

function textNodesWithin(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function rangeForCharRange(root: HTMLElement, start: number, end: number): Range | null {
  let offset = 0;
  let startContainer: Text | undefined;
  let startOffset = 0;
  let endContainer: Text | undefined;
  let endOffset = 0;
  for (const node of textNodesWithin(root)) {
    const length = node.data.length;
    if (!startContainer && offset + length > start) {
      startContainer = node;
      startOffset = start - offset;
    }
    if (offset + length >= end) {
      endContainer = node;
      endOffset = end - offset;
      break;
    }
    offset += length;
  }
  if (!startContainer || !endContainer) return null;
  const range = document.createRange();
  range.setStart(startContainer, Math.max(0, startOffset));
  range.setEnd(endContainer, Math.max(0, endOffset));
  return range;
}

interface SelectionTarget {
  readonly pageAnchor: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly rect: DOMRect;
}

function selectionTarget(surface: HTMLElement): SelectionTarget | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const section = (
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement
  )?.closest<HTMLElement>('.user-document-reader__text-section[id]');
  if (!section || !surface.contains(section)) return null;
  const anchor = section.id;
  const nodes = textNodesWithin(section);
  const offsets = new Map<Text, number>();
  let acc = 0;
  for (const node of nodes) {
    offsets.set(node, acc);
    acc += node.data.length;
  }
  const startContainer = range.startContainer;
  const endContainer = range.endContainer;
  if (!(startContainer instanceof Text) || !(endContainer instanceof Text)) return null;
  const start = (offsets.get(startContainer) ?? 0) + range.startOffset;
  const end = (offsets.get(endContainer) ?? 0) + range.endOffset;
  if (end <= start) return null;
  return {
    pageAnchor: anchor,
    start,
    end,
    quote: selection.toString().slice(0, 400),
    rect: range.getBoundingClientRect(),
  };
}

/**
 * Persistent text highlighting for user documents: selections inside text
 * sections are saved to IndexedDB and painted with CSS Custom Highlights,
 * leaving the reader DOM untouched.
 */
export function UserDocumentHighlights(props: {
  readonly documentId: string;
  readonly surface: () => HTMLElement | undefined;
}): JSX.Element {
  const [highlights, setHighlights] = createSignal<readonly UserDocumentHighlight[]>([]);
  const [popup, setPopup] = createSignal<{
    readonly x: number;
    readonly y: number;
    readonly add: SelectionTarget | null;
    readonly remove: UserDocumentHighlight | null;
  } | null>(null);

  const reload = (): void => {
    void loadUserHighlights(props.documentId)
      .then(setHighlights)
      .catch(() => undefined);
  };

  onMount(() => {
    reload();
    window.addEventListener(USER_HIGHLIGHTS_EVENT, reload);

    const refreshPopup = (): void => {
      const surface = props.surface();
      if (!surface) {
        setPopup(null);
        return;
      }
      const target = selectionTarget(surface);
      if (!target) {
        setPopup(null);
        return;
      }
      const intersecting = highlights().find(
        (item) =>
          item.pageAnchor === target.pageAnchor &&
          target.start >= item.start - 1 &&
          target.end <= item.end + 1,
      );
      setPopup({
        x: target.rect.left + target.rect.width / 2,
        y: target.rect.top,
        add: intersecting ? null : target,
        remove: intersecting ?? null,
      });
    };
    document.addEventListener('selectionchange', refreshPopup);
    const dismissPopupOnScroll = (): void => {
      setPopup(null);
    };
    window.addEventListener('scroll', dismissPopupOnScroll, {
      capture: true,
      passive: true,
    });
    onCleanup(() => {
      window.removeEventListener(USER_HIGHLIGHTS_EVENT, reload);
      document.removeEventListener('selectionchange', refreshPopup);
      window.removeEventListener('scroll', dismissPopupOnScroll, { capture: true });
      registry()?.delete(HIGHLIGHT_NAME);
    });
  });

  createEffect(() => {
    const surface = props.surface();
    const items = highlights();
    const highlightsRegistry = registry();
    if (!surface || !highlightsRegistry) return;
    const ranges: Range[] = [];
    for (const item of items) {
      const section = surface.querySelector<HTMLElement>(`#${CSS.escape(item.pageAnchor)}`);
      if (!section) continue;
      const range = rangeForCharRange(section, item.start, item.end);
      if (range) ranges.push(range);
    }
    if (ranges.length === 0) {
      highlightsRegistry.delete(HIGHLIGHT_NAME);
      return;
    }
    highlightsRegistry.set(HIGHLIGHT_NAME, new Highlight(...ranges));
  });

  return (
    <Show when={popup()}>
      {(popupValue) => (
        <Portal>
          <div
            class="user-highlight-popup"
            style={{ left: `${popupValue().x}px`, top: `${popupValue().y}px` }}
          >
            <Show
              when={popupValue().remove}
              fallback={
                <button
                  type="button"
                  class="user-highlight-popup__action"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    const target = popupValue().add;
                    if (!target) return;
                    void addUserHighlight({
                      documentId: props.documentId,
                      pageAnchor: target.pageAnchor,
                      start: target.start,
                      end: target.end,
                      quote: target.quote,
                    }).then(() => {
                      document.getSelection()?.removeAllRanges();
                      setPopup(null);
                    });
                  }}
                >
                  <AppGlyph name="highlighter" class="user-highlight-popup__icon" />
                  Выделить
                </button>
              }
            >
              {(remove) => (
                <button
                  type="button"
                  class="user-highlight-popup__action user-highlight-popup__action--remove"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    void removeUserHighlight(remove().id).then(() => {
                      document.getSelection()?.removeAllRanges();
                      setPopup(null);
                    });
                  }}
                >
                  <AppGlyph name="trash" class="user-highlight-popup__icon" />
                  Убрать выделение
                </button>
              )}
            </Show>
          </div>
        </Portal>
      )}
    </Show>
  );
}
