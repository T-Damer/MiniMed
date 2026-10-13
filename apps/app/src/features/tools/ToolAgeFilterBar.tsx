import type { JSX } from 'solid-js';
import { pluralRu } from '@/i18n/labels';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TOOL_AGE_FILTERS, type ToolAgeFilter } from '@/features/tools/tool-age-filter';

import '@/features/tools/tool-age.css';

const DEFAULT_WHAT = ['инструмент', 'инструмента', 'инструментов'] as const;
const OPTIONS = TOOL_AGE_FILTERS.map((entry) => ({ value: entry.id, label: entry.label }));

/** «Дети / Взрослые / Все» for any list of tools; the choice is remembered by the caller. */
export function ToolAgeFilterBar(props: {
  readonly value: ToolAgeFilter;
  readonly onChange: (value: ToolAgeFilter) => void;
  /** How many tools the choice hides; shown so a short list is not mistaken for a short catalog. */
  readonly hidden?: number;
  /** What is counted, as one / few / many forms: «калькулятор», «калькулятора», «калькуляторов»; tools by default. */
  readonly what?: readonly [string, string, string];
  readonly class?: string;
}): JSX.Element {
  return (
    <div class={`tool-age-filter ${props.class ?? ''}`.trim()} data-testid="tool-age-filter">
      <SegmentedControl<ToolAgeFilter>
        class="tool-age-filter__control"
        label="Для кого инструмент"
        options={OPTIONS}
        value={props.value}
        onChange={props.onChange}
      />
      {props.hidden !== undefined && props.hidden > 0 ? (
        <span class="tool-age-filter__hidden" role="status">
          Скрыто по возрасту: {props.hidden}{' '}
          {pluralRu(props.hidden, ...(props.what ?? DEFAULT_WHAT))}
        </span>
      ) : null}
    </div>
  );
}
