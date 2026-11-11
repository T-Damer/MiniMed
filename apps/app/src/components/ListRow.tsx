import { type JSX, Show, splitProps } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import '@/components/ListRow.css';

/**
 * The app's list (owner 2026-11-11 «больше списков»): an inset group of large rows — a coloured
 * icon tile, a title, one quiet line, a value at the end and a chevron — as in Settings and the
 * search home's «Разделы». Use it wherever the content is a list of alike things (forms, sections,
 * folders, sources); a card is for one thing that needs room of its own.
 */

/** The tile palette: the same muted colours in both themes, a light glyph on them. */
export type ListTileTone = 'blue' | 'orange' | 'green' | 'purple' | 'pink' | 'teal' | 'gray';

export function ListGroup(props: {
  readonly heading?: JSX.Element;
  /** Names the list for assistive tech when there is no visible heading. */
  readonly label?: string;
  readonly class?: string;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <section class={`list-group${props.class ? ` ${props.class}` : ''}`} aria-label={props.label}>
      <Show when={props.heading}>
        <h2 class="list-group__heading">{props.heading}</h2>
      </Show>
      <ul class="list-group__list">{props.children}</ul>
    </section>
  );
}

export interface ListRowProps {
  /** The row opens this address (a link); otherwise `onClick` makes it a button. */
  readonly href?: string | undefined;
  readonly onClick?: (event: MouseEvent) => void | undefined;
  readonly icon?: AppGlyphName | undefined;
  readonly tone?: ListTileTone | undefined;
  /** Instead of the icon tile: a picture, an avatar, a thumbnail (2.25 rem square). */
  readonly leading?: JSX.Element | undefined;
  readonly title: JSX.Element;
  /** One quiet line under the title: what is inside, a count, a size. */
  readonly subtitle?: JSX.Element | undefined;
  /** A short value at the end of the row (a status, a count). */
  readonly value?: JSX.Element | undefined;
  /** A button of its own after the row (download, delete): it does not open the row. */
  readonly action?: JSX.Element | undefined;
  /** The chevron after the value; shown by default when the row opens something. */
  readonly chevron?: boolean | undefined;
  readonly selected?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly class?: string | undefined;
  readonly 'aria-label'?: string | undefined;
  readonly 'data-testid'?: string | undefined;
}

export function ListRow(props: ListRowProps): JSX.Element {
  const [local] = splitProps(props, ['href', 'onClick']);
  const opens = (): boolean => local.href !== undefined || local.onClick !== undefined;
  const body = (): JSX.Element => (
    <>
      <Show
        when={props.leading}
        fallback={
          <Show when={props.icon}>
            {(icon) => (
              <span class={`list-tile list-tile--${props.tone ?? 'gray'}`} aria-hidden="true">
                <AppGlyph name={icon()} class="list-tile__glyph" />
              </span>
            )}
          </Show>
        }
      >
        <span class="list-row__leading" aria-hidden="true">
          {props.leading}
        </span>
      </Show>
      <span class="list-row__text">
        <span class="list-row__title">{props.title}</span>
        <Show when={props.subtitle}>
          <span class="list-row__subtitle">{props.subtitle}</span>
        </Show>
      </span>
      <Show when={props.value}>
        <span class="list-row__value">{props.value}</span>
      </Show>
      <Show when={props.chevron ?? (opens() && !props.action)}>
        <AppGlyph name="caret-right" class="list-row__chevron" aria-hidden="true" />
      </Show>
    </>
  );
  const mainClass = (): string =>
    `list-row__main${props.selected ? ' list-row__main--selected' : ''}`;
  return (
    <li
      class={`list-row${props.class ? ` ${props.class}` : ''}`}
      classList={{ 'list-row--with-action': Boolean(props.action) }}
      data-testid={props['data-testid']}
    >
      <Show
        when={local.href !== undefined}
        fallback={
          <Show when={local.onClick} fallback={<div class={mainClass()}>{body()}</div>}>
            {(onClick) => (
              <button
                type="button"
                class={`${mainClass()} list-row__main--button`}
                disabled={props.disabled}
                aria-label={props['aria-label']}
                onClick={(event) => onClick()(event)}
              >
                {body()}
              </button>
            )}
          </Show>
        }
      >
        <a
          class={mainClass()}
          href={local.href}
          aria-label={props['aria-label']}
          aria-current={props.selected ? 'page' : undefined}
        >
          {body()}
        </a>
      </Show>
      <Show when={props.action}>
        <span class="list-row__action">{props.action}</span>
      </Show>
    </li>
  );
}
