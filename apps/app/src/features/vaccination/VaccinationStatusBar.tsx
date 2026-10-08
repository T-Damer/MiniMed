import { For, type JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import type { StatusFocus } from '@/features/vaccination/VaccinationChartView';
import type { StatusCounts } from '@/features/vaccination/vaccination-status';

const TILES = [
  { status: 'done', label: 'Сделано' },
  { status: 'planned', label: 'План' },
  { status: 'now', label: 'Сейчас' },
  { status: 'overdue', label: 'Просрочено' },
] as const satisfies readonly { status: StatusFocus; label: string }[];

/**
 * What the child has, what is planned, what is due now and what is overdue, as four tiles. A tile
 * picks that group out in the chart; the checklist button sets everything overdue as done.
 */
export function VaccinationStatusBar(props: {
  readonly counts: StatusCounts;
  readonly focus: StatusFocus | undefined;
  readonly onFocus: (focus: StatusFocus | undefined) => void;
  readonly onMarkOverdue: () => void;
}): JSX.Element {
  return (
    <fieldset class="vax-status">
      <legend class="sr-only">Состояние прививок</legend>
      <For each={TILES}>
        {(tile) => (
          <button
            type="button"
            class={`vax-status__tile vax-status__tile--${tile.status}`}
            classList={{ 'vax-status__tile--active': props.focus === tile.status }}
            aria-pressed={props.focus === tile.status}
            disabled={props.counts[tile.status] === 0}
            data-status={tile.status}
            onClick={() => props.onFocus(props.focus === tile.status ? undefined : tile.status)}
          >
            <span class="vax-status__count">{props.counts[tile.status]}</span>
            <span class="vax-status__label">{tile.label}</span>
          </button>
        )}
      </For>
      <Button
        type="button"
        variant="icon"
        class="vax-status__all"
        aria-label="Отметить просроченные как сделанные"
        title="Отметить просроченные как сделанные"
        disabled={props.counts.overdue === 0}
        icon={<AppGlyph name="list-checks" />}
        onClick={props.onMarkOverdue}
      />
    </fieldset>
  );
}
