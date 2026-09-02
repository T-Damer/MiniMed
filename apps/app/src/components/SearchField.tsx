import { createUniqueId, type JSX, Show, splitProps } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

export interface SearchFieldProps {
  readonly value: string;
  readonly onInput: (value: string) => void;
  readonly placeholder?: string;
  readonly label?: string;
  readonly hideLabel?: boolean;
  readonly id?: string;
  readonly type?: 'search' | 'text';
  readonly tone?: 'default' | 'inverse';
  readonly class?: string;
  readonly leading?: JSX.Element;
  readonly onClear?: (() => void) | undefined;
  readonly autocomplete?: string;
  readonly inputRef?: (element: HTMLInputElement) => void;
  readonly onKeyDown?: JSX.EventHandlerUnion<HTMLInputElement, KeyboardEvent>;
}

export function SearchField(props: SearchFieldProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    'value',
    'onInput',
    'placeholder',
    'label',
    'hideLabel',
    'id',
    'type',
    'tone',
    'class',
    'leading',
    'onClear',
    'autocomplete',
    'inputRef',
  ]);

  const generatedId = createUniqueId();
  const fieldId = () => local.id ?? `archive-search-input-${generatedId}`;
  const labelText = () => local.label ?? 'Поиск';

  return (
    <label
      class={`archive-search${local.class ? ` ${local.class}` : ''}`}
      classList={{
        'archive-search--inverse': local.tone === 'inverse',
      }}
    >
      <span class="archive-search__label" classList={{ 'sr-only': local.hideLabel ?? false }}>
        {labelText()}
      </span>
      <span class="archive-search__control">
        {local.leading ?? <AppGlyph name="search" class="archive-search__icon" />}
        <input
          {...rest}
          id={fieldId()}
          ref={local.inputRef}
          class="archive-search__input"
          data-fuzzy="true"
          data-search-focus-target="true"
          type={local.type ?? 'search'}
          value={local.value}
          placeholder={local.placeholder}
          autocomplete={local.autocomplete ?? 'off'}
          onInput={(event) => local.onInput(event.currentTarget.value)}
        />
        <Show when={local.onClear && local.value.length > 0}>
          <button
            type="button"
            class="archive-search__clear"
            aria-label="Очистить поиск"
            title="Очистить поиск"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              local.onClear?.();
            }}
          >
            <AppGlyph name="close" class="archive-search__clear-icon" />
          </button>
        </Show>
      </span>
    </label>
  );
}
