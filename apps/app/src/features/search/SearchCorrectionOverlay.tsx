import { createSignal, For, type JSX, onCleanup, onMount } from 'solid-js';

import { type CorrectionPiece, correctedText } from '@/features/search/search-correction';

import '@/features/search/search-correction.css';

export interface SearchCorrectionOverlayProps {
  /** The search field the overlay lies over, letter for letter. */
  readonly field: HTMLTextAreaElement;
  readonly pieces: readonly CorrectionPiece[];
  /** Puts the corrected text in the field. */
  readonly onApply: (text: string) => void;
}

/** Text metrics copied from the field so the overlay's letters sit where the field's would. */
const MIRRORED = [
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-indent',
  'text-transform',
] as const;

/**
 * The typed query drawn over the search field with its spelling correction: the wrong letters
 * struck out in red, the right letters added in green. The field's own text is hidden meanwhile;
 * tapping the overlay puts the corrected text in the field.
 */
export function SearchCorrectionOverlay(props: SearchCorrectionOverlayProps): JSX.Element {
  const [box, setBox] = createSignal<JSX.CSSProperties>({});
  const measure = () => {
    const field = props.field;
    const style = getComputedStyle(field);
    const mirrored: JSX.CSSProperties = {
      top: `${String(field.offsetTop)}px`,
      left: `${String(field.offsetLeft)}px`,
      width: `${String(field.offsetWidth)}px`,
      height: `${String(field.offsetHeight)}px`,
    };
    for (const property of MIRRORED) mirrored[property] = style.getPropertyValue(property);
    setBox(mirrored);
  };
  onMount(() => {
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(props.field);
    onCleanup(() => observer.disconnect());
  });
  const corrected = () => correctedText(props.pieces);

  return (
    <button
      type="button"
      class="search-correction"
      style={box()}
      aria-label={`Исправлено на «${corrected()}». Нажмите, чтобы исправить в поле`}
      title="Исправить в поле"
      data-testid="search-correction"
      onClick={() => props.onApply(corrected())}
    >
      <span class="search-correction__text" aria-hidden="true">
        <For each={props.pieces}>
          {(piece) => (
            <span
              class="search-correction__piece"
              classList={{
                'search-correction__piece--removed': piece.kind === 'removed',
                'search-correction__piece--added': piece.kind === 'added',
              }}
            >
              {piece.text}
            </span>
          )}
        </For>
      </span>
    </button>
  );
}
