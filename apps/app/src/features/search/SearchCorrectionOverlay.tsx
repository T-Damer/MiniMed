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

/** Runs of unchanged text and runs of edits; each run of edits is one tappable fix. */
function segments(
  pieces: readonly CorrectionPiece[],
): readonly { readonly fix: boolean; readonly pieces: readonly CorrectionPiece[] }[] {
  const result: { fix: boolean; pieces: CorrectionPiece[] }[] = [];
  for (const piece of pieces) {
    const fix = piece.kind !== 'same';
    const last = result.at(-1);
    if (last?.fix === fix) last.pieces.push(piece);
    else result.push({ fix, pieces: [piece] });
  }
  return result;
}

/**
 * The typed query drawn over the search field with its spelling correction: the wrong letters
 * struck out in red, the right letters added in green. The field's own text is hidden meanwhile.
 * Only the marked letters take taps (they put the corrected text in the field); a tap anywhere else
 * reaches the field, which then hides the correction for editing.
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
    <div class="search-correction" style={box()} data-testid="search-correction">
      <span class="search-correction__text">
        <For each={segments(props.pieces)}>
          {(segment) =>
            segment.fix ? (
              <button
                type="button"
                class="search-correction__fix"
                aria-label={`Исправить на «${corrected()}»`}
                title="Исправить"
                onClick={() => props.onApply(corrected())}
              >
                <For each={segment.pieces}>
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
              </button>
            ) : (
              <span class="search-correction__piece" aria-hidden="true">
                {segment.pieces.map((piece) => piece.text).join('')}
              </span>
            )
          }
        </For>
      </span>
    </div>
  );
}
