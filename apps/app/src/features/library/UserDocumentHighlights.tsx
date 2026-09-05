import { createEffect, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { UserHighlightPopup } from '@/features/library/UserHighlightPopup';
import {
  addUserHighlight,
  loadUserHighlights,
  removeUserHighlight,
  USER_HIGHLIGHT_COLORS,
  USER_HIGHLIGHTS_EVENT,
  type UserDocumentHighlight,
  userHighlightColor,
} from '@/state/user-library-highlights';

const highlightName = (color: string): string => `user-doc-highlights-${color}`;

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
  )?.closest<HTMLElement>('.user-document-reader__text-section[id], [data-user-doc-anchor][id]');
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
      .catch(() => toast.error('Не удалось загрузить выделения.'));
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
        // Clicking an existing mark also collapses the native selection asynchronously.
        if (!popup()?.remove) setPopup(null);
        return;
      }
      const intersecting = highlights().find(
        (item) =>
          item.pageAnchor === target.pageAnchor &&
          target.start < item.end &&
          target.end > item.start,
      );
      setPopup({
        x: target.rect.left + target.rect.width / 2,
        y: target.rect.top,
        add: intersecting ? null : target,
        remove: intersecting ?? null,
      });
    };
    let popupFrame: number | undefined;
    const schedulePopupRefresh = (): void => {
      if (popupFrame !== undefined) return;
      popupFrame = requestAnimationFrame(() => {
        popupFrame = undefined;
        refreshPopup();
      });
    };
    const selectHighlight = (event: MouseEvent): void => {
      const surface = props.surface();
      if (!surface?.contains(event.target as Node) || !document.getSelection()?.isCollapsed) return;
      for (const item of highlights().toReversed()) {
        const section = surface.querySelector<HTMLElement>(`#${CSS.escape(item.pageAnchor)}`);
        const range = section && rangeForCharRange(section, item.start, item.end);
        const rect =
          range &&
          Array.from(range.getClientRects()).find(
            (rect) =>
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom,
          );
        if (!rect) continue;
        if (popupFrame !== undefined) cancelAnimationFrame(popupFrame);
        popupFrame = undefined;
        setPopup({ x: event.clientX, y: rect.top, add: null, remove: item });
        return;
      }
    };
    document.addEventListener('click', selectHighlight);
    document.addEventListener('selectionchange', schedulePopupRefresh);
    const repositionPopupOnScroll = (event: Event): void => {
      if (
        event.target !== document &&
        event.target !== window &&
        event.target instanceof Node &&
        !props.surface()?.contains(event.target)
      )
        return;
      const current = popup();
      const target = current?.add ?? current?.remove;
      if (!current || !target) return;
      const section = props
        .surface()
        ?.querySelector<HTMLElement>(`#${CSS.escape(target.pageAnchor)}`);
      const range = section && rangeForCharRange(section, target.start, target.end);
      const rect = range?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) {
        setPopup(null);
        return;
      }
      setPopup({ ...current, x: rect.left + rect.width / 2, y: rect.top });
    };
    window.addEventListener('scroll', repositionPopupOnScroll, {
      capture: true,
      passive: true,
    });
    onCleanup(() => {
      window.removeEventListener(USER_HIGHLIGHTS_EVENT, reload);
      document.removeEventListener('selectionchange', schedulePopupRefresh);
      if (popupFrame !== undefined) cancelAnimationFrame(popupFrame);
      window.removeEventListener('scroll', repositionPopupOnScroll, { capture: true });
      document.removeEventListener('click', selectHighlight);
      for (const color of USER_HIGHLIGHT_COLORS) registry()?.delete(highlightName(color.id));
    });
  });

  createEffect(() => {
    const surface = props.surface();
    const items = highlights();
    const highlightsRegistry = registry();
    if (!surface || !highlightsRegistry) return;
    const paint = (): void => {
      for (const color of USER_HIGHLIGHT_COLORS) {
        const ranges: Range[] = [];
        for (const item of items) {
          if (item.cfiRange || userHighlightColor(item.color).id !== color.id) continue;
          const section = surface.querySelector<HTMLElement>(`#${CSS.escape(item.pageAnchor)}`);
          if (!section) continue;
          const range = rangeForCharRange(section, item.start, item.end);
          if (range) ranges.push(range);
        }
        highlightsRegistry.set(highlightName(color.id), new Highlight(...ranges));
      }
    };
    paint();
    const observer = new MutationObserver(paint);
    observer.observe(surface, { childList: true, subtree: true, characterData: true });
    onCleanup(() => observer.disconnect());
  });

  return (
    <Show when={popup()}>
      {(popupValue) => (
        <UserHighlightPopup
          x={popupValue().x}
          y={popupValue().y}
          onClose={() => setPopup(null)}
          onAdd={
            popupValue().add
              ? async (color) => {
                  const target = popupValue().add;
                  if (!target) return;
                  await addUserHighlight({
                    documentId: props.documentId,
                    pageAnchor: target.pageAnchor,
                    start: target.start,
                    end: target.end,
                    quote: target.quote,
                    color,
                  });
                  document.getSelection()?.removeAllRanges();
                  setPopup(null);
                }
              : undefined
          }
          onRemove={
            popupValue().remove
              ? async () => {
                  const target = popupValue().remove;
                  if (!target) return;
                  await removeUserHighlight(target.id);
                  document.getSelection()?.removeAllRanges();
                  setPopup(null);
                }
              : undefined
          }
        />
      )}
    </Show>
  );
}
