import { type JSX, onCleanup, onMount, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';

import '@/components/EmptyState.css';

/**
 * What a list shows while it has nothing (owner 2026-11-01, AGENTS.md «Empty states»): icon, a
 * line or two of text and the actions, centred in the empty space below the header — never stuck
 * to the top of an empty screen. It measures where it starts and fills the rest of the viewport
 * (above the bottom bar), so the page still does not scroll.
 */
export function EmptyState(props: {
  readonly glyph: AppGlyphName;
  readonly title: string;
  readonly text?: string;
  /** Buttons, the main one first. */
  readonly actions?: JSX.Element;
  readonly class?: string;
  readonly 'data-testid'?: string;
}): JSX.Element {
  let element: HTMLDivElement | undefined;

  const measure = (): void => {
    if (!element) return;
    const top = element.getBoundingClientRect().top + window.scrollY;
    element.style.setProperty('--empty-state-top', `${Math.max(0, Math.round(top))}px`);
  };

  onMount(() => {
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    if (element?.parentElement) observer.observe(element.parentElement);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      ref={element}
      class={`ui-empty-state${props.class ? ` ${props.class}` : ''}`}
      data-testid={props['data-testid']}
    >
      <div class="ui-empty-state__body">
        <span class="ui-empty-state__badge" aria-hidden="true">
          <AppGlyph name={props.glyph} class="ui-empty-state__glyph" />
        </span>
        <h2 class="ui-empty-state__title">{props.title}</h2>
        <Show when={props.text}>
          <p class="ui-empty-state__text">{props.text}</p>
        </Show>
        <Show when={props.actions}>
          <div class="ui-empty-state__actions">{props.actions}</div>
        </Show>
      </div>
    </div>
  );
}
