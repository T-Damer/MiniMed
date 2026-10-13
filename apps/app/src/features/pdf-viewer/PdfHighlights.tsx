import { createEffect, createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { highlightSegments } from '@/features/anchoring/highlight-sync';
import { createQuoteSelector, type TextQuoteSelector } from '@/features/anchoring/text-anchor';
import {
  HIGHLIGHT_QUOTE_LIMIT,
  highlightQuoteMatches,
} from '@/features/library/highlight-popup-placement';
import { highlightStatusNote } from '@/features/library/highlight-status';
import {
  APPROXIMATE_HIGHLIGHT_NAME,
  popupPoint,
  registry,
  unionRect,
} from '@/features/library/UserDocumentHighlights';
import { UserHighlightPopup } from '@/features/library/UserHighlightPopup';
import { createDocumentHighlightStore } from '@/features/library/use-document-highlights';
import { buildPdfPageHighlight } from '@/features/pdf-viewer/pdf-find-dom';
import { pdfPageIndexFromUnitId, pdfPageUnitId } from '@/features/pdf-viewer/pdf-find-state';
import { type PdfSelectionTarget, pdfSelectionTargets } from '@/features/pdf-viewer/pdf-selection';
import type { PdfViewerModel } from '@/features/pdf-viewer/pdf-viewer-model';
import {
  addUserHighlight,
  removeUserHighlight,
  USER_HIGHLIGHT_COLORS,
  type UserDocumentHighlight,
  userHighlightColor,
} from '@/state/user-library-highlights';

const highlightName = (color: string): string => `user-doc-highlights-${color}`;

interface PdfPopup {
  readonly x: number;
  readonly y: number;
  readonly placement: ReturnType<typeof popupPoint>['placement'];
  readonly add: readonly PdfSelectionTarget[] | null;
  readonly remove: readonly UserDocumentHighlight[];
}

/**
 * Highlights on the text layer of a PDF: select text, pick a colour, and the highlight is saved as
 * a text-quote anchor on the page's text (pdf.js text, the same units find searches). When the file
 * is replaced by a newer one, the highlights are re-anchored by their quotes anywhere in the new
 * text (`syncHighlights`), like those of a text document. Pages without a text layer (scans) carry
 * none. No drawing: only selected words are marked.
 */
export function PdfHighlights(props: {
  readonly model: PdfViewerModel;
  readonly documentId: string;
  /** The element holding the page boxes. */
  readonly pages: () => HTMLElement | undefined;
}): JSX.Element {
  const store = createDocumentHighlightStore({ documentId: () => props.documentId });
  const model = props.model;
  const [popup, setPopup] = createSignal<PdfPopup | null>(null);

  /** The ranges of a highlight on the pages that are drawn right now. */
  const rangesFor = (item: UserDocumentHighlight): readonly Range[] => {
    if (item.anchorStatus === 'missing' || item.cfiRange) return [];
    const ranges: Range[] = [];
    for (const [index, segment] of highlightSegments(item).entries()) {
      const pageIndex = pdfPageIndexFromUnitId(segment.pageAnchor);
      if (pageIndex === undefined) continue;
      const layer = model.textLayerParts(pageIndex);
      const text = model.pageText(pageIndex);
      if (!layer || !text) continue;
      if (
        index === 0 &&
        !highlightQuoteMatches(text.text, segment.start, segment.end, item.quote)
      ) {
        continue;
      }
      ranges.push(
        ...buildPdfPageHighlight(layer, text, [
          { start: segment.start, end: segment.end, active: false },
        ]).hit,
      );
    }
    return ranges;
  };

  // The text of every page is what a selection is placed in and a highlight is found again by.
  createEffect(() => {
    if (model.pageCount() > 0) model.ensureText();
  });

  createEffect(() => {
    if (!store.loaded() || store.highlights().length === 0 || !model.textComplete()) return;
    model.textVersion();
    const units = Array.from({ length: model.pageCount() }, (_, pageIndex) => ({
      id: pdfPageUnitId(pageIndex),
      text: model.pageText(pageIndex)?.text ?? '',
    }));
    void store.sync(units);
  });

  createEffect(() => {
    const items = store.highlights();
    model.layerVersion();
    model.textVersion();
    const highlightsRegistry = registry();
    if (!highlightsRegistry) return;
    const approximate: Range[] = [];
    for (const color of USER_HIGHLIGHT_COLORS) {
      const ranges: Range[] = [];
      for (const item of items) {
        if (userHighlightColor(item.color).id !== color.id) continue;
        const found = rangesFor(item);
        ranges.push(...found);
        if (item.anchorStatus === 'approximate') approximate.push(...found);
      }
      highlightsRegistry.set(highlightName(color.id), new Highlight(...ranges));
    }
    highlightsRegistry.set(APPROXIMATE_HIGHLIGHT_NAME, new Highlight(...approximate));
  });

  onMount(() => {
    const snapshot = (): { targets: readonly PdfSelectionTarget[]; rect: DOMRect } | null => {
      const root = props.pages();
      const selection = document.getSelection();
      if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return null;
      const targets = pdfSelectionTargets(range, root, model);
      return targets.length > 0 ? { targets, rect: range.getBoundingClientRect() } : null;
    };
    const refresh = (): void => {
      const current = snapshot();
      if (!current) {
        // Clicking an existing mark also collapses the native selection asynchronously.
        if (!(popup()?.remove.length ?? 0)) setPopup(null);
        return;
      }
      const intersecting = store
        .highlights()
        .filter((item) =>
          highlightSegments(item).some((segment) =>
            current.targets.some(
              (target) =>
                target.pageAnchor === segment.pageAnchor &&
                target.start < segment.end &&
                target.end > segment.start,
            ),
          ),
        );
      setPopup({
        ...popupPoint(current.rect),
        add: intersecting.length > 0 ? null : current.targets,
        remove: intersecting,
      });
    };
    let frame: number | undefined;
    const scheduleRefresh = (): void => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        refresh();
      });
    };
    const selectHighlight = (event: MouseEvent): void => {
      const root = props.pages();
      if (!root?.contains(event.target as Node) || !document.getSelection()?.isCollapsed) return;
      for (const item of store.highlights().toReversed()) {
        const rect = rangesFor(item)
          .flatMap((range) => Array.from(range.getClientRects()))
          .find(
            (candidate) =>
              event.clientX >= candidate.left &&
              event.clientX <= candidate.right &&
              event.clientY >= candidate.top &&
              event.clientY <= candidate.bottom,
          );
        if (!rect) continue;
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        setPopup({
          ...popupPoint({ left: event.clientX, width: 0, top: rect.top, bottom: rect.bottom }),
          add: null,
          remove: [item],
        });
        return;
      }
    };
    const followScroll = (): void => {
      const current = popup();
      if (!current || current.placement === 'dock') return;
      const rect = current.add
        ? snapshot()?.rect
        : unionRect(current.remove.flatMap((item) => rangesFor(item)));
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) {
        setPopup(null);
        return;
      }
      setPopup({ ...current, ...popupPoint(rect) });
    };
    document.addEventListener('click', selectHighlight);
    document.addEventListener('selectionchange', scheduleRefresh);
    window.addEventListener('scroll', followScroll, { capture: true, passive: true });
    onCleanup(() => {
      document.removeEventListener('click', selectHighlight);
      document.removeEventListener('selectionchange', scheduleRefresh);
      window.removeEventListener('scroll', followScroll, { capture: true });
      if (frame !== undefined) cancelAnimationFrame(frame);
      for (const color of USER_HIGHLIGHT_COLORS) registry()?.delete(highlightName(color.id));
      registry()?.delete(APPROXIMATE_HIGHLIGHT_NAME);
    });
  });

  const selectorFor = (target: PdfSelectionTarget): TextQuoteSelector => {
    const pageIndex = pdfPageIndexFromUnitId(target.pageAnchor) ?? 0;
    const text = model.pageText(pageIndex)?.text ?? '';
    return createQuoteSelector(text, target.start, target.end, {
      before: model.pageText(pageIndex - 1)?.text.slice(-60) ?? '',
      after: model.pageText(pageIndex + 1)?.text.slice(0, 60) ?? '',
    });
  };

  return (
    <Show when={popup()}>
      {(value) => (
        <UserHighlightPopup
          x={value().x}
          y={value().y}
          placement={value().placement}
          note={
            value().remove.length === 1
              ? highlightStatusNote(value().remove[0] as UserDocumentHighlight)
              : undefined
          }
          onClose={() => setPopup(null)}
          onAdd={
            value().add
              ? async (color) => {
                  for (const target of value().add ?? []) {
                    await addUserHighlight({
                      documentId: props.documentId,
                      pageAnchor: target.pageAnchor,
                      start: target.start,
                      end: target.end,
                      quote: target.quote.slice(0, HIGHLIGHT_QUOTE_LIMIT),
                      selector: selectorFor(target),
                      color,
                    });
                  }
                  document.getSelection()?.removeAllRanges();
                  setPopup(null);
                }
              : undefined
          }
          onRemove={
            value().remove.length > 0
              ? async () => {
                  for (const item of value().remove) await removeUserHighlight(item.id);
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
