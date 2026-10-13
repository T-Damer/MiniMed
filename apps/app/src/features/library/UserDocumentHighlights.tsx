import { createEffect, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { highlightSegments } from '@/features/anchoring/highlight-sync';
import { type AnchorUnit, createQuoteSelector } from '@/features/anchoring/text-anchor';
import {
  HIGHLIGHT_QUOTE_LIMIT,
  type HighlightPopupPlacement,
  highlightPopupPlacement,
  highlightQuoteMatches,
} from '@/features/library/highlight-popup-placement';
import { highlightStatusNote } from '@/features/library/highlight-status';
import { UserHighlightPopup } from '@/features/library/UserHighlightPopup';
import { openReaderDictionary } from '@/features/reader-dictionary/reader-dictionary-state';
import { cleanSelection } from '@/features/reader-dictionary/selection-term';
import { createDocumentHighlightStore } from '@/features/library/use-document-highlights';
import {
  addUserHighlight,
  removeUserHighlight,
  USER_HIGHLIGHT_COLORS,
  type UserDocumentHighlight,
  userHighlightColor,
} from '@/state/user-library-highlights';

const highlightName = (color: string): string => `user-doc-highlights-${color}`;
/** Highlights carried over by similarity rather than by identical words: drawn with a dotted line. */
export const APPROXIMATE_HIGHLIGHT_NAME = 'user-doc-highlights-approximate';
/** Quiet time after the last text change before highlights are settled against the text. */
const SYNC_DELAY_MS = 450;

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
  readonly selector: ReturnType<typeof createQuoteSelector>;
}

interface SelectionSnapshot {
  /** One target per text container the selection touches, each clipped to the selection. */
  readonly targets: readonly SelectionTarget[];
  readonly rect: DOMRect;
  /** The selected text as the browser reports it, for the dictionary lookup. */
  readonly text: string;
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
  const containers = Array.from(surface.querySelectorAll<HTMLElement>(containerSelector));
  for (const [index, container] of containers.entries()) {
    if (!range.intersectsNode(container)) continue;
    const text = containerText(container);
    const start = container.contains(range.startContainer)
      ? offsetWithin(container, range.startContainer, range.startOffset)
      : 0;
    const end = container.contains(range.endContainer)
      ? offsetWithin(container, range.endContainer, range.endOffset)
      : text.length;
    if (end <= start) continue;
    const previous = containers[index - 1];
    const following = containers[index + 1];
    targets.push({
      pageAnchor: container.id,
      start,
      end,
      quote: text.slice(start, end).slice(0, HIGHLIGHT_QUOTE_LIMIT),
      selector: createQuoteSelector(text, start, end, {
        before: previous ? containerText(previous).slice(-60) : '',
        after: following ? containerText(following).slice(0, 60) : '',
      }),
    });
  }
  if (targets.length === 0) return null;
  return { targets, rect: range.getBoundingClientRect(), text: selection.toString() };
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
  /** Selected text to look up in the dictionary; `null` when a stored mark was tapped. */
  readonly lookup: string | null;
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

/** The text units the highlights are settled against: one per text container on the page. */
function collectUnits(surface: HTMLElement, selector: string): readonly AnchorUnit[] {
  return Array.from(surface.querySelectorAll<HTMLElement>(selector)).map((container) => ({
    id: container.id,
    text: containerText(container),
  }));
}

/**
 * Persistent text highlighting: selections inside text containers are saved to IndexedDB and
 * painted with CSS Custom Highlights, leaving the reader DOM untouched. User documents highlight
 * inside their page/section elements; official documents inside their text chunks (`containers`).
 *
 * Every highlight carries a text-quote selector. Once the whole text is on the page (`ready`), the
 * highlights are settled against it: one still at its saved place stays, one whose text moved or
 * was reworded in a newer version is re-anchored (and marked), one that is gone is kept and listed
 * as not found, and the highlights of earlier editions (`predecessorDocumentIds`) are carried over.
 */
export function UserDocumentHighlights(props: {
  readonly documentId: string;
  readonly surface: () => HTMLElement | undefined;
  /** Selector of the elements whose text can carry a highlight. */
  readonly containers?: string;
  /** False while the document is still being put on the page; re-anchoring waits for the rest. */
  readonly ready?: boolean;
  /** Earlier editions of this document, nearest first: their highlights are carried over. */
  readonly predecessorDocumentIds?: readonly string[];
}): JSX.Element {
  const containerSelector = (): string => props.containers ?? USER_DOCUMENT_HIGHLIGHT_CONTAINERS;
  const store = createDocumentHighlightStore({
    documentId: () => props.documentId,
    predecessorDocumentIds: () => props.predecessorDocumentIds ?? [],
  });
  const highlights = store.highlights;
  const [popup, setPopup] = createSignal<PopupState | null>(null);

  const containerFor = (surface: HTMLElement, anchor: string): HTMLElement | null =>
    surface.querySelector<HTMLElement>(`#${CSS.escape(anchor)}`);

  /**
   * The ranges of a stored highlight; empty when its text is not on the page or is not there any
   * more (the primary piece is checked against its quote before it is painted).
   */
  const rangesFor = (surface: HTMLElement, item: UserDocumentHighlight): readonly Range[] => {
    if (item.anchorStatus === 'missing' || item.cfiRange) return [];
    const ranges: Range[] = [];
    for (const [index, segment] of highlightSegments(item).entries()) {
      const container = containerFor(surface, segment.pageAnchor);
      if (!container) return [];
      if (
        index === 0 &&
        !highlightQuoteMatches(containerText(container), segment.start, segment.end, item.quote)
      ) {
        return [];
      }
      const range = rangeForCharRange(container, segment.start, segment.end);
      if (range) ranges.push(range);
    }
    return ranges;
  };

  onMount(() => {
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
        highlightSegments(item).some((segment) =>
          snapshot.targets.some(
            (target) =>
              segment.pageAnchor === target.pageAnchor &&
              target.start < segment.end &&
              target.end > segment.start,
          ),
        ),
      );
      setPopup({
        ...popupPoint(snapshot.rect),
        add: intersecting.length > 0 ? null : snapshot.targets,
        remove: intersecting,
        lookup: cleanSelection(snapshot.text) ?? null,
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
        const rect = rangesFor(surface, item)
          .flatMap((range) => Array.from(range.getClientRects()))
          .find(
            (candidate) =>
              event.clientX >= candidate.left &&
              event.clientX <= candidate.right &&
              event.clientY >= candidate.top &&
              event.clientY <= candidate.bottom,
          );
        if (!rect) continue;
        if (popupFrame !== undefined) cancelAnimationFrame(popupFrame);
        popupFrame = undefined;
        setPopup({
          ...popupPoint({ left: event.clientX, width: 0, top: rect.top, bottom: rect.bottom }),
          add: null,
          remove: [item],
          lookup: cleanSelection(item.quote) ?? null,
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
        : unionRect(current.remove.flatMap((item) => rangesFor(surface, item)));
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
      document.removeEventListener('selectionchange', schedulePopupRefresh);
      if (popupFrame !== undefined) cancelAnimationFrame(popupFrame);
      window.removeEventListener('scroll', repositionPopupOnScroll, { capture: true });
      document.removeEventListener('click', selectHighlight);
      for (const color of USER_HIGHLIGHT_COLORS) registry()?.delete(highlightName(color.id));
      registry()?.delete(APPROXIMATE_HIGHLIGHT_NAME);
    });
  });

  // Paint, and settle the highlights against the text once all of it is on the page.
  createEffect(() => {
    const surface = props.surface();
    const items = highlights();
    const loaded = store.loaded();
    const ready = props.ready !== false;
    const highlightsRegistry = registry();
    if (!surface) return;
    const paint = (): void => {
      if (!highlightsRegistry) return;
      const approximate: Range[] = [];
      for (const color of USER_HIGHLIGHT_COLORS) {
        const ranges: Range[] = [];
        for (const item of items) {
          if (userHighlightColor(item.color).id !== color.id) continue;
          const found = rangesFor(surface, item);
          ranges.push(...found);
          if (item.anchorStatus === 'approximate') approximate.push(...found);
        }
        highlightsRegistry.set(highlightName(color.id), new Highlight(...ranges));
      }
      highlightsRegistry.set(APPROXIMATE_HIGHLIGHT_NAME, new Highlight(...approximate));
    };
    paint();
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleSync = (): void => {
      if (!ready || !loaded) return;
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = undefined;
        void store.sync(collectUnits(surface, containerSelector()));
      }, SYNC_DELAY_MS);
    };
    scheduleSync();
    const observer = new MutationObserver(() => {
      paint();
      scheduleSync();
    });
    observer.observe(surface, { childList: true, subtree: true, characterData: true });
    onCleanup(() => {
      observer.disconnect();
      if (syncTimer) clearTimeout(syncTimer);
    });
  });

  return (
    <Show when={popup()}>
      {(popupValue) => (
        <UserHighlightPopup
          x={popupValue().x}
          y={popupValue().y}
          placement={popupValue().placement}
          note={
            popupValue().remove.length === 1
              ? highlightStatusNote(popupValue().remove[0] as UserDocumentHighlight)
              : undefined
          }
          onClose={() => setPopup(null)}
          onLookup={
            popupValue().lookup
              ? () => {
                  const text = popupValue().lookup;
                  if (text) openReaderDictionary(text);
                  document.getSelection()?.removeAllRanges();
                  setPopup(null);
                }
              : undefined
          }
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
                      selector: target.selector,
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
