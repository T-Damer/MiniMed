import { createUniqueId, type JSX, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { HelpIconLink } from '@/components/HelpIconLink';

export interface HomeFeatureAction {
  readonly label: string;
  readonly icon?: AppGlyphName;
  readonly run?: () => void;
  readonly href?: string;
  /** Set while the action cannot work yet; the button stays visible, disabled, with the reason. */
  readonly unavailableReason?: string;
}

function HomeFeatureActionControl(props: {
  readonly action: HomeFeatureAction;
  readonly secondary?: boolean;
}): JSX.Element {
  const className = (): string =>
    `home-feature__action${props.secondary ? ' home-feature__action--secondary' : ''}`;
  const content = (): JSX.Element => (
    <>
      <Show when={props.action.icon}>
        {(icon) => <AppGlyph class="home-feature__action-icon" name={icon()} />}
      </Show>
      {props.action.label}
    </>
  );
  return (
    <Show
      when={props.action.href && !props.action.unavailableReason}
      fallback={
        <button
          type="button"
          class={className()}
          disabled={Boolean(props.action.unavailableReason)}
          title={props.action.unavailableReason}
          onClick={() => props.action.run?.()}
        >
          {content()}
        </button>
      }
    >
      <a class={className()} href={props.action.href}>
        {content()}
      </a>
    </Show>
  );
}

/**
 * One capability on the home screen: its name, one line on what it does, one way to try it right
 * now and, when there is one, a second way in the same row. «Как это работает» is a round «?»
 * beside the name.
 */
export function HomeFeatureCard(props: {
  readonly icon: AppGlyphName;
  readonly title: string;
  readonly text: string;
  readonly action: HomeFeatureAction;
  readonly secondary?: HomeFeatureAction;
  readonly helpHref?: string;
}): JSX.Element {
  const titleId = createUniqueId();
  const available = (): boolean =>
    !props.action.unavailableReason && Boolean(props.action.run ?? props.action.href);
  /** A tap anywhere on the card does what its first button does (buttons and links keep theirs). */
  const openFromCard = (event: MouseEvent): void => {
    if (!available()) return;
    if (event.target instanceof Element && event.target.closest('a, button, input, label')) return;
    if (props.action.run) props.action.run();
    else if (props.action.href) window.location.assign(props.action.href);
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the card's first button is the keyboard path to the same action.
    <section
      class="home-feature"
      classList={{ 'home-feature--clickable': available() }}
      aria-labelledby={titleId}
      onClick={openFromCard}
    >
      <div class="home-feature__head">
        <h2 class="home-feature__title" id={titleId}>
          <AppGlyph class="home-feature__title-icon" name={props.icon} />
          {props.title}
        </h2>
        <Show when={props.helpHref}>{(href) => <HelpIconLink href={href()} />}</Show>
      </div>
      <p class="home-feature__text">{props.text}</p>
      <div class="home-feature__actions">
        <HomeFeatureActionControl action={props.action} />
        <Show when={props.secondary}>
          {(secondary) => <HomeFeatureActionControl action={secondary()} secondary />}
        </Show>
        <Show when={props.action.unavailableReason}>
          {(reason) => <p class="home-feature__reason">{reason()}</p>}
        </Show>
      </div>
    </section>
  );
}
