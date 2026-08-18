import { type JSX, splitProps } from 'solid-js';

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
  readonly autocomplete?: string;
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
    'autocomplete',
  ]);

  const fieldId = () => local.id ?? 'archive-search-input';
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
        <AppGlyph name="search" class="archive-search__icon" />
        <input
          {...rest}
          id={fieldId()}
          class="archive-search__input"
          data-fuzzy="true"
          data-search-focus-target="true"
          type={local.type ?? 'search'}
          value={local.value}
          placeholder={local.placeholder}
          autocomplete={local.autocomplete ?? 'off'}
          onInput={(event) => local.onInput(event.currentTarget.value)}
        />
      </span>
    </label>
  );
}
