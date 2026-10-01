import { createEffect, createUniqueId, For, type JSX, on, onCleanup, Show } from 'solid-js';

import { Button } from '@/components/Button';
import type { CardPlacement, Size } from './onboarding-geometry';
import type { OnboardingStep } from './onboarding-steps';

/**
 * The floating hint card of the tour. It glides to its place next to the control it explains and
 * measures itself, so the page can keep it clear of that control. «Далее» carries the shared
 * view-transition name that the intro's button flies into.
 */
export function OnboardingHintCard(props: {
  readonly step: OnboardingStep;
  /** Position among all steps as the user counts them (the intro is the first). */
  readonly position: number;
  readonly total: number;
  readonly placement: CardPlacement | undefined;
  readonly coreReady: boolean;
  readonly canGoBack: boolean;
  /** «Далее» is flying in from the intro: no entrance animation, the card is simply there. */
  readonly instant: boolean;
  readonly onSize: (size: Size) => void;
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly onSkip: () => void;
  readonly children?: JSX.Element;
}): JSX.Element {
  const titleId = createUniqueId();
  const textId = createUniqueId();
  let card: HTMLElement | undefined;
  // Read once: a body that arrives during the flight has no entrance, later ones do.
  const instantAtStart = props.instant;

  // Each step moves focus into the card, so keyboard and screen-reader users follow the tour.
  createEffect(
    on(
      () => props.step.id,
      () => card?.focus({ preventScroll: true }),
    ),
  );

  return (
    <section
      ref={(element) => {
        card = element;
        const observer = new ResizeObserver(() =>
          props.onSize({ width: element.offsetWidth, height: element.offsetHeight }),
        );
        observer.observe(element);
        props.onSize({ width: element.offsetWidth, height: element.offsetHeight });
        onCleanup(() => observer.disconnect());
      }}
      class="onboarding-hint"
      classList={{
        'onboarding-hint--placed': props.placement !== undefined,
        'onboarding-hint--instant': props.instant,
      }}
      data-side={props.placement?.side ?? 'center'}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={textId}
      tabindex="-1"
      style={{
        transform: props.placement
          ? `translate3d(${props.placement.left}px, ${props.placement.top}px, 0)`
          : undefined,
      }}
    >
      <header class="onboarding-hint__top">
        <span class="onboarding-hint__counter">
          <span class="sr-only">Шаг </span>
          {props.position} / {props.total}
        </span>
        <ol class="onboarding-hint__dots" aria-hidden="true">
          <For each={Array.from({ length: props.total }, (_, index) => index + 1)}>
            {(number) => (
              <li
                class="onboarding-hint__dot"
                classList={{
                  'onboarding-hint__dot--done': number < props.position,
                  'onboarding-hint__dot--active': number === props.position,
                }}
              />
            )}
          </For>
        </ol>
        <Button class="onboarding-hint__skip" variant="quiet" onClick={props.onSkip}>
          Пропустить
        </Button>
      </header>

      <Show when={props.step} keyed>
        {(step) => (
          <div
            class="onboarding-hint__body"
            classList={{ 'onboarding-hint__body--instant': instantAtStart }}
          >
            <h2 class="onboarding-hint__title" id={titleId}>
              {step.title}
            </h2>
            <div class="onboarding-hint__text" id={textId} aria-live="polite">
              <For each={step.paragraphs}>
                {(text) => <p class="onboarding-hint__paragraph">{text}</p>}
              </For>
              <Show when={step.bullets}>
                {(bullets) => (
                  <ul class="onboarding-hint__list">
                    <For each={bullets()}>
                      {(item) => <li class="onboarding-hint__item">{item}</li>}
                    </For>
                  </ul>
                )}
              </Show>
              <Show when={step.notice}>
                {(notice) => <p class="onboarding-hint__notice">{notice()}</p>}
              </Show>
            </div>
            {props.children}
          </div>
        )}
      </Show>

      <footer class="onboarding-hint__actions">
        <Button
          class="onboarding-hint__back"
          variant="quiet"
          disabled={!props.canGoBack}
          onClick={props.onBack}
        >
          Назад
        </Button>
        <Button
          class="onboarding-hint__next"
          classList={{
            'onboarding-hint__next--ready': props.coreReady && props.step.finishLabel !== undefined,
          }}
          variant="primary"
          onClick={props.onNext}
        >
          {props.step.finishLabel ?? 'Далее'}
        </Button>
      </footer>
    </section>
  );
}
