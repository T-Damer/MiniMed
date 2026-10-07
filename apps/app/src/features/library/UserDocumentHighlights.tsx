import { createEffect, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import {
  HIGHLIGHT_QUOTE_LIMIT,
  type HighlightPopupPlacement,
  highlightPopupPlacement,
  highlightQuoteMatches,
} from '@/features/library/highlight-popup-placement';
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

/** Containers of a user document's text: a page/section element whose `id` is the stored anchor. */
export const USER_DOCUMENT_HIGHLIGHT_CONTAINERS =
  '.user-document-reader__text-section[id], [data-user-doc-anchor][id]';
/** Containers of an official document's text: one text chunk, whose `id` is the chunk anchor. */
export const OFFICIAL_DOCUMENT_HIGHLIGHT_CONTAINERS = '.document-text-chunk[id]';

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

function containerText(container: HTMLElement): string {
  return textNodesWithin(container)
    .map((node) => node.data)
    .join('');
}

/** Character offset of a DOM point inside `container`, counted over its text nodes. */
function offsetWithin(container: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(container);
  range.setEnd(node, offset);
  return range.toString().length;
}

interface SelectionTarget {
  readonly pageAnchor: string;
  readonly start: number;
  readonly end: number;
  readonly quote: string;
}

interface SelectionSnapshot {
  /** One target per text container the selection touches, each clipped to the selection. */
  readonly targets: readonly SelectionTarget[];
  readonly rect: DOMRect;
}

/**
 * The selection as highlight targets. A selection that crosses chunks or sections yields one
 * target per container, so it can be saved and painted whatever the container boundaries are.
 */
function selectionSnapshot(
  surface: HTMLElement,
  containerSelector: string,
): SelectionSnapshot | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const targets: SelectionTarget[] = [];
  for (const container of Array.from(surface.querySelectorAll<HTMLElement>(containerSelector))) {
    if (!range.intersectsNode(container)) continue;
    const text = containerText(container);
    const start = container.contains(range.startContainer)
      ? offsetWithin(container, range.startContainer, range.startOffset)
      : 0;
    const end = container.contains(range.endContainer)
      ? offsetWithin(container, range.endContainer, range.endOffset)
      : text.length;
    if (end <= start) continue;
    targets.push({
      pageAnchor: container.id,
      start,
      end,
      quote: text.slice(start, end).slice(0, HIGHLIGHT_QUOTE_LIMIT),
    });
  }
  if (targets.length === 0) return null;
  return { targets, rect: range.getBoundingClientRect() };
}

function isTouchPrimary(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** Bounding box of the ranges that are on screen; `undefined` when none is. */
function unionRect(ranges: readonly (Range | null)[]): DOMRect | undefined {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const range of ranges) {
    if (!range) continue;
    const rect = range.getBoundingClientRect();
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return Number.isFinite(left) ? new DOMRect(left, top, right - left, bottom - top) : undefined;
}

interface PopupState {
  readonly x: number;
  readonly y: number;
  readonly placement: HighlightPopupPlacement;
  readonly add: readonly SelectionTarget[] | null;
  readonly remove: readonly UserDocumentHighlight[];
}

function popupPoint(
  rect: Pick<DOMRect, 'left' | 'width' | 'top' | 'bottom'>,
): Pick<PopupState, 'x' | 'y' | 'placement'> {
  const placement = highlightPopupPlacement(
    rect,
    window.visualViewport?.height ?? window.innerHeight,
    isTouchPrimary(),
  );
  return {
    x: rect.left + rect.width / 2,
    y: placement === 'above' ? rect.top : rect.bottom,
    placement,
  };
}

/**
 * Persistent text highlighting: selections inside text containers are saved to IndexedDB and
 * painted with CSS Custom Highlights, leaving the reader DOM untouched. User documents highlight
 * inside their page/section elements; official documents inside their text chunks (`containers`),
 * with each stored highlight checked against its quote before it is painted.
 */
export function UserDocumentHighlights(props: {
  readonly documentId: string;
  readonly surface: () => HTMLElement | undefined;
  /** Selector of the elements whose text can carry a highlight. */
  readonly containers?: string;
  /** Hide a stored highlight whose text no longer matches its quote (official documents). */
  readonly verifyQuote?: boolean;
}): JSX.Element {
  const containerSelector = (): string => props.containers ?? USER_DOCUMENT_HIGHLIGHT_CONTAINERS;
  const [highlights, setHighlights] = createSignal<readonly UserDocumentHighlight[]>([]);
  const [popup, setPopup] = createSignal<PopupState | null>(null);

  const reload = (): void => {
    void loadUserHighlights(props.documentId)
      .then(setHighlights)
      .catch(() => toast.error('Не удалось загрузить выделения.'));
  };

  const containerFor = (surface: HTMLElement, anchor: string): HTMLElement | null =>
    surface.querySelector<HTMLElement>(`#${CSS.escape(anchor)}`);

  /** The range of a stored highlight, or `null` when its text is not on screen (or has changed). */
  const rangeFor = (surface: HTMLElement, item: UserDocumentHighlight): Range | null => {
    const container = containerFor(surface, item.pageAnchor);
    if (!container) return null;
    if (
      props.verifyQuote &&
      !highlightQuoteMatches(containerText(container), item.start, item.end, item.quote)
    ) {
      return null;
    }
    return rangeForCharRange(container, item.start, item.end);
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
      const snapshot = selectionSnapshot(surface, containerSelector());
      if (!snapshot) {
        // Clicking an existing mark also collapses the native selection asynchronously.
        if (!(popup()?.remove.length ?? 0)) setPopup(null);
        return;
      }
      const intersecting = highlights().filter((item) =>
        snapshot.targets.some(
          (target) =>
            item.pageAnchor === target.pageAnchor &&
            target.start < item.end &&
            target.end > item.start,
        ),
      );
      setPopup({
        ...popupPoint(snapshot.rect),
        add: intersecting.length > 0 ? null : snapshot.targets,
        remove: intersecting,
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
        const range = rangeFor(surface, item);
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
        setPopup({
          ...popupPoint({ left: event.clientX, width: 0, top: rect.top, bottom: rect.bottom }),
          add: null,
          remove: [item],
        });
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
      if (!current || current.placement === 'dock') return;
      const surface = props.surface();
      if (!surface) return;
      const rect = current.add
        ? selectionSnapshot(surface, containerSelector())?.rect
        : unionRect(current.remove.map((item) => rangeFor(surface, item)));
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) {
        setPopup(null);
        return;
      }
      setPopup({ ...current, ...popupPoint(rect) });
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
          const range = rangeFor(surface, item);
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
          placement={popupValue().placement}
          onClose={() => setPopup(null)}
          onAdd={
            popupValue().add
              ? async (color) => {
                  const targets = popupValue().add;
                  if (!targets) return;
                  for (const target of targets) {
                    await addUserHighlight({
                      documentId: props.documentId,
                      pageAnchor: target.pageAnchor,
                      start: target.start,
                      end: target.end,
                      quote: target.quote,
                      color,
                    });
                  }
                  document.getSelection()?.removeAllRanges();
                  setPopup(null);
                }
              : undefined
          }
          onRemove={
            popupValue().remove.length > 0
              ? async () => {
                  for (const target of popupValue().remove) await removeUserHighlight(target.id);
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
