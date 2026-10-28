import { type JSX, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import {
  type StatGridColumns,
  type StatTone,
  statCardClass,
  statGridClass,
} from '@/components/stat-card';

import '@/components/stat-card.css';

export type { StatGridColumns, StatTone } from '@/components/stat-card';

export interface StatCardProps {
  /** The number (or short figure such as «77 %»): what the card is about. */
  readonly value: string | number;
  /** What the value counts, naming the entity («записей», «телефон подключён»). */
  readonly label: string;
  readonly icon?: AppGlyphName;
  readonly tone?: StatTone;
  /** One quiet line under the label: a delta, a period, a date. */
  readonly hint?: string;
  /** Makes the card a button with press feedback. */
  readonly onClick?: () => void;
  /** For a filter card: it is the one currently chosen (`aria-pressed`). */
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  /** Accessible name for an interactive card; defaults to «value label». */
  readonly ariaLabel?: string;
  readonly class?: string;
}

/**
 * Summary tile: a strong figure, its label and a tone. A defined border and a raised paper surface
 * keep it visible on the page in both themes; the tone colours the figure, the left bar and the
 * icon chip. Put several in a `StatGrid`.
 */
export function StatCard(props: StatCardProps): JSX.Element {
  const interactive = (): boolean => props.onClick !== undefined;
  const body = (): JSX.Element => (
    <>
      <span class="ui-stat-card__head">
        <Show when={props.icon}>
          {(icon) => (
            <span class="ui-stat-card__chip" aria-hidden="true">
              <AppGlyph name={icon()} class="ui-stat-card__icon" />
            </span>
          )}
        </Show>
        <span class="ui-stat-card__value">{props.value}</span>
      </span>
      <span class="ui-stat-card__label">{props.label}</span>
      <Show when={props.hint}>
        <span class="ui-stat-card__hint">{props.hint}</span>
      </Show>
    </>
  );
  return (
    <Show
      when={interactive()}
      fallback={
        <div class={statCardClass({ tone: props.tone, interactive: false, class: props.class })}>
          {body()}
        </div>
      }
    >
      <button
        type="button"
        class={statCardClass({
          tone: props.tone,
          interactive: true,
          pressed: props.pressed,
          class: props.class,
        })}
        aria-pressed={props.pressed}
        aria-label={props.ariaLabel}
        disabled={props.disabled}
        onClick={() => props.onClick?.()}
      >
        {body()}
      </button>
    </Show>
  );
}

export interface StatGridProps {
  /** 2 (default), 3 or 4 on a wide screen; four tiles drop to two on a phone. */
  readonly columns?: StatGridColumns;
  readonly class?: string;
  readonly children: JSX.Element;
}

/** A row-wrapping grid of `StatCard`s that fits 375 px. */
export function StatGrid(props: StatGridProps): JSX.Element {
  return <div class={statGridClass(props.columns, props.class)}>{props.children}</div>;
}
