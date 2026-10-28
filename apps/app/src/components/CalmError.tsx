import { type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { CalmErrorArt } from '@/components/CalmErrorArt';

import './calm-error.css';

/**
 * The shared whole-page error state: a floating cloud of wool in front of a slowly breathing circle
 * («Вдох» / «Выдох», 4 s each), a plain statement of what failed, one line on what happens next and
 * one action. Use it wherever a screen as a whole could not be shown (a screen that did not load,
 * the local database that did not open); an error inside a reader or a card keeps its own, smaller
 * state. The breath and the cloud stop when animations are off or reduced.
 */
export function CalmError(props: {
  /** The fact, plainly: «Экран не загрузился». */
  readonly title: string;
  /** One line on what happens next. */
  readonly detail?: string | undefined;
  /** The only action; the label defaults to «Повторить». Without a handler no button is drawn. */
  readonly actionLabel?: string;
  readonly onAction?: (() => void) | undefined;
  /** Sits inside another surface (no desk paper, no full-screen height). */
  readonly embedded?: boolean;
  readonly testId?: string;
}): JSX.Element {
  return (
    <div
      class="calm-error"
      classList={{
        'calm-error--embedded': props.embedded === true,
        'page-surface': props.embedded !== true,
        'page-grain': props.embedded !== true,
      }}
      role="alert"
      data-testid={props.testId}
    >
      <div class="calm-error__scene">
        <CalmErrorArt />
        <p class="calm-error__breath-label" aria-hidden="true">
          <span class="calm-error__breath-word calm-error__breath-word--in">Вдох</span>
          <span class="calm-error__breath-word calm-error__breath-word--out">Выдох</span>
        </p>
      </div>
      <h1 class="calm-error__title">{props.title}</h1>
      <Show when={props.detail}>{(detail) => <p class="calm-error__detail">{detail()}</p>}</Show>
      <Show when={props.onAction}>
        {(action) => (
          <span class="calm-error__action">
            <Button type="button" variant="secondary" onClick={() => action()()}>
              {props.actionLabel ?? 'Повторить'}
            </Button>
          </span>
        )}
      </Show>
    </div>
  );
}
