import { createSignal, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { RollingNumber } from '@/components/RollingNumber';
import { parseReaderPage, readerPageAriaLabel } from '@/features/library/document-reader-position';

import './reader-page-bubble.css';

const MORPH_MS = 180;
const MORPH_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * «12 / 94»: the page the reader is on, as a small bubble in the bottom-left corner that stays out
 * of the text. The digits roll as the page changes. A tap turns the bubble into a field in place —
 * the same pill grows to hold the field and a «go» arrow — and the jump is instant.
 */
export function ReaderPageBubble(props: {
  readonly page: number;
  readonly total: number;
  readonly onGo: (page: number) => void;
  /** Moves out of the way (the contents drawer covers the page). */
  readonly hidden?: boolean;
}): JSX.Element {
  const [editing, setEditing] = createSignal(false);
  const [invalid, setInvalid] = createSignal(false);
  let form: HTMLFormElement | undefined;
  let input: HTMLInputElement | undefined;

  /** Changes what the pill holds and eases its width from the old size to the new one. */
  const morph = (mutate: () => void): void => {
    if (!form) {
      mutate();
      return;
    }
    const before = form.getBoundingClientRect().width;
    mutate();
    const after = form.getBoundingClientRect().width;
    if (Math.abs(before - after) < 1) return;
    form.animate([{ width: `${String(before)}px` }, { width: `${String(after)}px` }], {
      duration: MORPH_MS,
      easing: MORPH_EASING,
    });
  };

  const open = (): void => {
    if (editing()) return;
    morph(() => {
      setInvalid(false);
      setEditing(true);
    });
    if (!input) return;
    input.value = String(props.page);
    // `preventScroll`: the field must not drag the page anywhere when it takes focus.
    input.focus({ preventScroll: true });
    input.select();
  };
  const close = (): void => {
    if (!editing()) return;
    morph(() => {
      setEditing(false);
      setInvalid(false);
    });
  };

  const submit = (event: SubmitEvent): void => {
    event.preventDefault();
    const page = parseReaderPage(input?.value ?? '', props.total);
    if (page === null) {
      setInvalid(true);
      input?.focus({ preventScroll: true });
      input?.select();
      return;
    }
    close();
    props.onGo(page);
  };

  const totalLabel = (): string => `/ ${String(props.total)}`;

  return (
    <div
      class="reader-page-dock"
      classList={{ 'reader-page-dock--hidden': props.hidden ?? false }}
      data-reader-page-dock
    >
      <form
        ref={(element) => {
          form = element;
        }}
        class="reader-page-bubble"
        classList={{
          'reader-page-bubble--editing': editing(),
          'reader-page-bubble--invalid': invalid(),
        }}
        style={{ '--reader-page-digits': String(String(props.total).length) }}
        onSubmit={submit}
        onFocusOut={(event) => {
          // Only the field leaving counts: the summary button that the field replaces loses focus
          // as it is removed, and that must not close the bubble it has just opened.
          if (event.target !== input) return;
          const next = event.relatedTarget;
          if (next instanceof Node && form?.contains(next)) return;
          close();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !editing()) return;
          event.preventDefault();
          event.stopPropagation();
          close();
        }}
      >
        <Show
          when={editing()}
          fallback={
            <button
              type="button"
              class="reader-page-bubble__summary"
              aria-label={readerPageAriaLabel(props.page, props.total)}
              data-reader-page-bubble="summary"
              onClick={open}
            >
              <RollingNumber class="reader-page-bubble__current" value={props.page} />
              <span class="reader-page-bubble__total" aria-hidden="true">
                {totalLabel()}
              </span>
            </button>
          }
        >
          <span class="reader-page-bubble__editor">
            <input
              ref={(element) => {
                input = element;
              }}
              class="reader-page-bubble__input"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              enterkeyhint="go"
              aria-label={`Страница, от 1 до ${String(props.total)}`}
              aria-invalid={invalid()}
              data-reader-page-bubble="input"
              value={String(props.page)}
              onInput={() => setInvalid(false)}
            />
            <span class="reader-page-bubble__total" aria-hidden="true">
              {totalLabel()}
            </span>
            <button
              type="submit"
              class="reader-page-bubble__go"
              aria-label="Перейти к странице"
              data-reader-page-bubble="go"
              // The field keeps focus while the arrow is pressed: a blur first would close the bubble
              // before the tap lands (touch browsers that do not focus buttons report no related target).
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
            >
              <AppGlyph name="arrow-right" class="reader-page-bubble__go-icon" />
            </button>
          </span>
        </Show>
      </form>
    </div>
  );
}
