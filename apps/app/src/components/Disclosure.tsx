import { createSignal, createUniqueId, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

import '@/components/Disclosure.css';

export interface DisclosureProps {
  readonly title: JSX.Element;
  /** Controlled state; omit both `open` and `onToggle` to let the section manage itself. */
  readonly open?: boolean;
  readonly onToggle?: (open: boolean) => void;
  readonly defaultOpen?: boolean;
  /** `card` is a bordered panel; `inline` is a compact text row for secondary details. */
  readonly variant?: 'card' | 'inline';
  /** The title keeps to one line and ends in an ellipsis (a row of a compact list). */
  readonly singleLine?: boolean;
  /** Short trailing meta such as a count; rendered before the chevron. */
  readonly meta?: JSX.Element;
  readonly description?: string;
  /**
   * A control that shares the header's row (a download chip, say). It stays outside the toggle
   * button, so interactive content never nests inside it.
   */
  readonly action?: JSX.Element;
  readonly class?: string;
  readonly children: JSX.Element;
}

/**
 * Animated, accessible accordion section. The panel height animates through a
 * 0fr → 1fr grid track, so content of any height expands smoothly without measuring.
 * Children mount on first open and stay mounted so collapsing can animate out.
 */
export function Disclosure(props: DisclosureProps): JSX.Element {
  const panelId = createUniqueId();
  const [ownOpen, setOwnOpen] = createSignal(props.defaultOpen ?? false);
  const open = (): boolean => props.open ?? ownOpen();
  const [visited, setVisited] = createSignal(open());
  const toggle = (): void => {
    const next = !open();
    if (next) setVisited(true);
    setOwnOpen(next);
    props.onToggle?.(next);
  };
  // Rendered once per branch of the `Show` below; only one of them is ever on screen.
  const header = (): JSX.Element => (
    <button
      class="ui-disclosure__header"
      classList={{ 'ui-disclosure__header--with-action': props.action !== undefined }}
      type="button"
      aria-expanded={open()}
      aria-controls={panelId}
      onClick={toggle}
    >
      <span
        class="ui-disclosure__heading"
        classList={{ 'ui-disclosure__heading--compact': props.action !== undefined }}
      >
        <span class="ui-disclosure__title">{props.title}</span>
        <Show when={props.description}>
          {(description) => <span class="ui-disclosure__description">{description()}</span>}
        </Show>
      </span>
      <Show when={props.meta !== undefined}>
        <span class="ui-disclosure__meta">{props.meta}</span>
      </Show>
      <span class="ui-disclosure__chevron" classList={{ 'ui-disclosure__chevron--open': open() }}>
        <AppGlyph name="caret-down" class="ui-disclosure__chevron-icon" />
      </span>
    </button>
  );
  return (
    <section
      class={`ui-disclosure ${props.class ?? ''}`.trim()}
      classList={{
        'ui-disclosure--open': open(),
        'ui-disclosure--inline': props.variant === 'inline',
        'ui-disclosure--single-line': props.singleLine ?? false,
      }}
    >
      <Show when={props.action !== undefined} fallback={header()}>
        <div class="ui-disclosure__bar">
          {header()}
          <div class="ui-disclosure__action">{props.action}</div>
        </div>
      </Show>
      <div
        class="ui-disclosure__panel"
        classList={{ 'ui-disclosure__panel--open': open() }}
        id={panelId}
        inert={!open()}
      >
        <div class="ui-disclosure__inner">
          <Show when={visited() || open()}>
            <div
              class="ui-disclosure__content"
              classList={{ 'ui-disclosure__content--open': open() }}
            >
              {props.children}
            </div>
          </Show>
        </div>
      </div>
    </section>
  );
}
