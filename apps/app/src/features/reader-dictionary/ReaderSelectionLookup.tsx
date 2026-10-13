import { createSignal, type JSX, onCleanup, onMount, Show } from 'solid-js';

import {
  type HighlightPopupPlacement,
  highlightPopupPlacement,
} from '@/features/library/highlight-popup-placement';
import { UserHighlightPopup } from '@/features/library/UserHighlightPopup';
import { openReaderDictionary } from '@/features/reader-dictionary/reader-dictionary-state';
import { cleanSelection } from '@/features/reader-dictionary/selection-term';

interface LookupPopup {
  readonly x: number;
  readonly y: number;
  readonly placement: HighlightPopupPlacement;
  readonly text: string;
}

function isTouchPrimary(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** The popup for the selection inside `surface`, or `null` when it is not a word or short phrase. */
function popupForSelection(surface: HTMLElement): LookupPopup | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!surface.contains(range.commonAncestorContainer)) return null;
  const text = cleanSelection(selection.toString());
  if (!text) return null;
  const rect = range.getBoundingClientRect();
  const placement = highlightPopupPlacement(
    rect,
    window.visualViewport?.height ?? window.innerHeight,
    isTouchPrimary(),
  );
  return {
    x: rect.left + rect.width / 2,
    y: placement === 'above' ? rect.top : rect.bottom,
    placement,
    text,
  };
}

/**
 * The selection menu of a reader that cannot mark text (the PDF text layer, official documents
 * other than clinical recommendations): one action, «Найти в словаре». Readers that do highlight
 * carry the same action in their own popup, so only one menu is ever open.
 */
export function ReaderSelectionLookup(props: {
  readonly surface: () => HTMLElement | undefined;
}): JSX.Element {
  const [popup, setPopup] = createSignal<LookupPopup | null>(null);

  onMount(() => {
    let frame: number | undefined;
    const refresh = (): void => {
      frame = undefined;
      const surface = props.surface();
      setPopup(surface ? popupForSelection(surface) : null);
    };
    const schedule = (): void => {
      if (frame === undefined) frame = requestAnimationFrame(refresh);
    };
    document.addEventListener('selectionchange', schedule);
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    onCleanup(() => {
      document.removeEventListener('selectionchange', schedule);
      window.removeEventListener('scroll', schedule, { capture: true });
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  });

  return (
    <Show when={popup()}>
      {(current) => (
        <UserHighlightPopup
          x={current().x}
          y={current().y}
          placement={current().placement}
          onClose={() => setPopup(null)}
          onLookup={() => {
            openReaderDictionary(current().text);
            document.getSelection()?.removeAllRanges();
            setPopup(null);
          }}
        />
      )}
    </Show>
  );
}
