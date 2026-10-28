import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';

import { createDebouncer } from '@/components/debounced-value';
import { TextField } from '@/components/TextField';
import { type DrugSuggestion, suggestDrugs } from './drug-suggest';
import './DrugSearchField.css';

const SUGGEST_DEBOUNCE_MS = 200;
const MIN_QUERY_LENGTH = 3;
const MAX_FORM_CHIPS = 3;

export interface DrugSearchFieldProps {
  /** The text in the input (the parent owns it: a pick usually replaces it with the name). */
  readonly value: string;
  /** Every edit of the text, undebounced; the suggestions wait for a pause by themselves. */
  readonly onInput: (text: string) => void;
  readonly onPick: (suggestion: DrugSuggestion) => void;
  readonly label: string;
  /** Hide the label visually; screen readers still read it. */
  readonly hideLabel?: boolean;
  readonly placeholder?: string;
  readonly class?: string;
  readonly 'data-testid'?: string;
}

function optionTitle(suggestion: DrugSuggestion): string {
  return suggestion.product
    ? `${suggestion.product} · ${suggestion.name.toLocaleLowerCase('ru-RU')}`
    : suggestion.name;
}

/**
 * The medicine name with a suggestion list (ARIA combobox with a listbox popup). Free text always
 * stays valid: the list only offers the shipped drug names, best first (`drug-suggest.ts`).
 *
 * The list sits in normal document flow right under the input instead of floating over the page:
 * a dialog or sheet that scrolls clips an absolutely positioned popup at its edge, a portal with
 * fixed positioning has to follow the scroll, the on-screen keyboard and the visual viewport, and
 * both need z-index bookkeeping. In flow it simply pushes the content below down, scrolls with the
 * dialog, never leaves the screen and needs no geometry code; it scrolls inside itself when long.
 */
export function DrugSearchField(props: DrugSearchFieldProps): JSX.Element {
  const listId = `drug-search-${createUniqueId()}`;
  const optionId = (index: number): string => `${listId}-option-${index}`;

  const [suggestions, setSuggestions] = createSignal<readonly DrugSuggestion[]>([]);
  // The text the current suggestions answer; the empty state shows only for a finished search.
  const [answered, setAnswered] = createSignal('');
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  let root: HTMLDivElement | undefined;
  let listElement: HTMLDivElement | undefined;
  let request = 0;

  const search = async (text: string): Promise<void> => {
    const current = ++request;
    const found = text.trim().length >= MIN_QUERY_LENGTH ? await suggestDrugs(text) : [];
    if (current !== request) return;
    setSuggestions(found);
    setAnswered(text);
    setActive(-1);
  };
  const debouncer = createDebouncer((text: string) => {
    void search(text);
  }, SUGGEST_DEBOUNCE_MS);
  onCleanup(() => {
    debouncer.cancel();
    request += 1;
  });

  const hasList = (): boolean => open() && suggestions().length > 0;
  const showEmpty = (): boolean =>
    open() &&
    suggestions().length === 0 &&
    answered() === props.value &&
    props.value.trim().length >= MIN_QUERY_LENGTH;

  const close = (): void => {
    setOpen(false);
    setActive(-1);
  };

  const pick = (suggestion: DrugSuggestion): void => {
    debouncer.cancel();
    request += 1;
    close();
    props.onPick(suggestion);
  };

  const move = (step: 1 | -1): void => {
    const count = suggestions().length;
    if (count === 0) return;
    if (!open()) {
      setOpen(true);
      setActive(step === 1 ? 0 : count - 1);
      return;
    }
    setActive((current) => (current + step + count) % count || 0);
  };

  const onKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions().length === 0) return;
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      const chosen = hasList() ? suggestions()[active()] : undefined;
      if (chosen) {
        event.preventDefault();
        pick(chosen);
      }
    } else if (event.key === 'Escape' && (hasList() || showEmpty())) {
      // Closes the list only; the dialog around the field stays open.
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const onFocusOut: JSX.EventHandler<HTMLDivElement, FocusEvent> = (event) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !root?.contains(next)) close();
  };

  // The highlighted option stays visible in a scrolled list.
  createEffect(
    on(active, (index) => {
      if (index < 0) return;
      const element = listElement?.children.item(index);
      if (element instanceof HTMLElement) element.scrollIntoView?.({ block: 'nearest' });
    }),
  );

  return (
    <div
      ref={(element) => {
        root = element;
      }}
      class={`drug-search-field${props.class ? ` ${props.class}` : ''}`}
      onFocusOut={onFocusOut}
    >
      <TextField
        class="drug-search-field__field"
        label={props.label}
        hideLabel={props.hideLabel ?? false}
        value={props.value}
        {...(props.placeholder === undefined ? {} : { placeholder: props.placeholder })}
        {...(props['data-testid'] === undefined ? {} : { 'data-testid': props['data-testid'] })}
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={hasList()}
        aria-controls={listId}
        aria-activedescendant={hasList() && active() >= 0 ? optionId(active()) : undefined}
        onInput={(event) => {
          const text = event.currentTarget.value;
          props.onInput(text);
          setOpen(true);
          debouncer.call(text);
        }}
        onFocus={() => {
          if (suggestions().length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <Show when={hasList()}>
        <div
          id={listId}
          ref={(element) => {
            listElement = element;
          }}
          class="drug-search-field__list"
          role="listbox"
          aria-label={props.label}
        >
          <For each={suggestions()}>
            {(suggestion, index) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: ARIA combobox pattern, focus stays in the input and its keydown handler picks the active option.
              <div
                id={optionId(index())}
                tabIndex={-1}
                class="drug-search-field__option"
                classList={{ 'drug-search-field__option--active': index() === active() }}
                role="option"
                aria-selected={index() === active()}
                // Keeps the focus in the input, so the list does not close before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index())}
                onClick={() => pick(suggestion)}
              >
                <span class="drug-search-field__heading">
                  <span class="drug-search-field__name">{optionTitle(suggestion)}</span>
                  <Show when={suggestion.essential}>
                    <span class="drug-search-field__badge">ЖНВЛП</span>
                  </Show>
                </span>
                <Show when={suggestion.forms.length > 0}>
                  <span class="drug-search-field__chips">
                    <For each={suggestion.forms.slice(0, MAX_FORM_CHIPS)}>
                      {(form) => <span class="drug-search-field__chip">{form.form}</span>}
                    </For>
                    <Show when={suggestion.forms.length > MAX_FORM_CHIPS}>
                      <span class="drug-search-field__chip drug-search-field__chip--more">
                        +{suggestion.forms.length - MAX_FORM_CHIPS}
                      </span>
                    </Show>
                  </span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={showEmpty()}>
        <p class="drug-search-field__empty" role="status">
          Ничего не нашлось — можно оставить своё название
        </p>
      </Show>
    </div>
  );
}
