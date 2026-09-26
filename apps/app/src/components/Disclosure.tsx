import { createSignal, createUniqueId, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';

import '@/components/Disclosure.css';

export interface DisclosureProps {
  readonly title: JSX.Element;
  readonly open: boolean;
  readonly onToggle: (open: boolean) => void;
  /** Short trailing meta such as a count; rendered before the chevron. */
  readonly meta?: JSX.Element;
  readonly description?: string;
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
  const [visited, setVisited] = createSignal(props.open);
  const toggle = (): void => {
    const next = !props.open;
    if (next) setVisited(true);
    props.onToggle(next);
  };
  return (
    <section
      class={`ui-disclosure ${props.class ?? ''}`.trim()}
      classList={{ 'ui-disclosure--open': props.open }}
    >
      <button
        class="ui-disclosure__header"
        type="button"
        aria-expanded={props.open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <span class="ui-disclosure__heading">
          <span class="ui-disclosure__title">{props.title}</span>
          <Show when={props.description}>
            {(description) => <span class="ui-disclosure__description">{description()}</span>}
          </Show>
        </span>
        <Show when={props.meta !== undefined}>
          <span class="ui-disclosure__meta">{props.meta}</span>
        </Show>
        <span
          class="ui-disclosure__chevron"
          classList={{ 'ui-disclosure__chevron--open': props.open }}
        >
          <AppGlyph name="caret-down" class="ui-disclosure__chevron-icon" />
        </span>
      </button>
      <div
        class="ui-disclosure__panel"
        classList={{ 'ui-disclosure__panel--open': props.open }}
        id={panelId}
        inert={!props.open}
      >
        <div class="ui-disclosure__inner">
          <Show when={visited() || props.open}>
            <div
              class="ui-disclosure__content"
              classList={{ 'ui-disclosure__content--open': props.open }}
            >
              {props.children}
            </div>
          </Show>
        </div>
      </div>
    </section>
  );
}
