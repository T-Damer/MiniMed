import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { SheetPopover } from '@/components/SheetPopover';

import '@/components/MultiPickField.css';

export interface MultiPickOption<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly selected: boolean;
  /** A colour dot before the label (colour choices). */
  readonly swatch?: string | undefined;
}

/**
 * A field that reads like an input — the chosen values or a placeholder, and a caret — and opens a
 * checkable list: a popover on wide screens, a bottom sheet on phones. Choices toggle in place; the
 * list stays open until dismissed, so several values are one trip.
 */
export function MultiPickField<Id extends string>(props: {
  readonly label: string;
  readonly placeholder: string;
  readonly options: readonly MultiPickOption<Id>[];
  readonly onToggle: (id: Id) => void;
  readonly testId?: string;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const chosen = (): string =>
    props.options
      .filter((option) => option.selected)
      .map((option) => option.label)
      .join(', ');
  return (
    <fieldset class="multi-pick" data-testid={props.testId}>
      <legend class="multi-pick__label">{props.label}</legend>
      <SheetPopover
        open={open()}
        onOpenChange={setOpen}
        title={props.label}
        triggerClass="multi-pick__control"
        triggerLabel={`${props.label}: ${chosen() || props.placeholder}`}
        trigger={
          <>
            <span
              class="multi-pick__value"
              classList={{ 'multi-pick__value--empty': chosen() === '' }}
            >
              {chosen() || props.placeholder}
            </span>
            <AppGlyph name="caret-down" class="multi-pick__caret" />
          </>
        }
        contentClass="multi-pick__panel"
      >
        <ul class="multi-pick__list">
          <For each={props.options}>
            {(option) => (
              <li class="multi-pick__item">
                <button
                  type="button"
                  class="multi-pick__option"
                  classList={{ 'multi-pick__option--on': option.selected }}
                  aria-pressed={option.selected ? 'true' : 'false'}
                  onClick={() => props.onToggle(option.id)}
                >
                  <Show when={option.swatch}>
                    {(swatch) => (
                      <span
                        class="multi-pick__swatch"
                        style={{ background: swatch() }}
                        aria-hidden="true"
                      />
                    )}
                  </Show>
                  <span class="multi-pick__option-label">{option.label}</span>
                  <AppGlyph
                    name="check"
                    class={`multi-pick__check${option.selected ? ' multi-pick__check--on' : ''}`}
                  />
                </button>
              </li>
            )}
          </For>
        </ul>
      </SheetPopover>
    </fieldset>
  );
}
