import { type JSX, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Disclosure } from '@/components/Disclosure';

import '@/components/FeatureCard.css';

export type FeatureCardTone = 'idle' | 'working' | 'ready' | 'error';

export interface FeatureCardProps {
  readonly icon: AppGlyphName;
  readonly title: string;
  /** What the user gets, in plain words; technical notes belong in `details`. */
  readonly summary: JSX.Element;
  readonly status: string;
  readonly tone: FeatureCardTone;
  /** 0–1 for a known fraction, null for an indeterminate transfer, undefined to hide the bar. */
  readonly progress?: number | null | undefined;
  readonly actions?: JSX.Element;
  readonly details?: JSX.Element;
  readonly detailsTitle?: string;
  readonly error?: string;
  readonly class?: string;
  readonly headingId?: string;
  readonly children?: JSX.Element;
}

/** Card for an optional, downloadable capability: benefit, state, one clear action. */
export function FeatureCard(props: FeatureCardProps): JSX.Element {
  return (
    <section
      class={`ui-feature-card paper-sheet ${props.class ?? ''}`.trim()}
      aria-labelledby={props.headingId}
    >
      <header class="ui-feature-card__header">
        <span
          class="ui-feature-card__icon"
          classList={{ [`ui-feature-card__icon--${props.tone}`]: true }}
        >
          <AppGlyph name={props.icon} class="ui-feature-card__glyph" />
        </span>
        <div class="ui-feature-card__heading">
          <h3 class="ui-feature-card__title" id={props.headingId}>
            {props.title}
          </h3>
          <span
            class="ui-feature-card__status"
            classList={{ [`ui-feature-card__status--${props.tone}`]: true }}
            role="status"
            aria-live="polite"
          >
            {props.status}
          </span>
        </div>
      </header>
      <p class="ui-feature-card__summary">{props.summary}</p>
      <Show when={props.progress !== undefined}>
        <span
          class="ui-feature-card__progress"
          role="progressbar"
          aria-label={props.status}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={
            typeof props.progress === 'number' ? Math.round(props.progress * 100) : undefined
          }
        >
          <span
            class="ui-feature-card__progress-fill"
            classList={{ 'ui-feature-card__progress-fill--indeterminate': props.progress === null }}
            style={{ '--ui-feature-card-progress': String(props.progress ?? 0.35) }}
          />
        </span>
      </Show>
      {props.children}
      <Show when={props.actions}>
        <div class="ui-feature-card__actions">{props.actions}</div>
      </Show>
      <Show when={props.error}>
        {(message) => (
          <p class="ui-feature-card__error" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <Show when={props.details}>
        <Disclosure
          variant="inline"
          class="ui-feature-card__details"
          title={props.detailsTitle ?? 'Подробнее'}
        >
          <div class="ui-feature-card__details-body">{props.details}</div>
        </Disclosure>
      </Show>
    </section>
  );
}
