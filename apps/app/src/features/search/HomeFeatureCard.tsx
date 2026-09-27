import { createUniqueId, type JSX, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';

export interface HomeFeatureAction {
  readonly label: string;
  readonly icon?: AppGlyphName;
  readonly run?: () => void;
  readonly href?: string;
  /** Set while the action cannot work yet; the button stays visible, disabled, with the reason. */
  readonly unavailableReason?: string;
}

/** One capability on the home screen: what it does, and one way to try it right now. */
export function HomeFeatureCard(props: {
  readonly icon: AppGlyphName;
  readonly kicker: string;
  readonly title: string;
  readonly text: string;
  readonly action: HomeFeatureAction;
  readonly link?: { readonly label: string; readonly href: string };
}): JSX.Element {
  const titleId = createUniqueId();
  return (
    <section class="home-feature" aria-labelledby={titleId}>
      <div class="home-feature__copy">
        <span class="home-feature__kicker">
          <AppGlyph class="home-feature__kicker-icon" name={props.icon} />
          {props.kicker}
        </span>
        <h2 class="home-feature__title" id={titleId}>
          {props.title}
        </h2>
        <p class="home-feature__text">{props.text}</p>
      </div>
      <div class="home-feature__actions">
        <Show
          when={props.action.href && !props.action.unavailableReason}
          fallback={
            <button
              type="button"
              class="home-feature__action"
              disabled={Boolean(props.action.unavailableReason)}
              title={props.action.unavailableReason}
              onClick={() => props.action.run?.()}
            >
              <Show when={props.action.icon}>
                {(icon) => <AppGlyph class="home-feature__action-icon" name={icon()} />}
              </Show>
              {props.action.label}
            </button>
          }
        >
          <a class="home-feature__action" href={props.action.href}>
            <Show when={props.action.icon}>
              {(icon) => <AppGlyph class="home-feature__action-icon" name={icon()} />}
            </Show>
            {props.action.label}
          </a>
        </Show>
        <Show when={props.action.unavailableReason}>
          {(reason) => <p class="home-feature__reason">{reason()}</p>}
        </Show>
        <Show when={props.link}>
          {(link) => (
            <a class="home-feature__link" href={link().href}>
              {link().label}
            </a>
          )}
        </Show>
      </div>
    </section>
  );
}
