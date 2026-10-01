import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';

import { afterBootReveal } from '@/app/boot-surface';
import { dismissSetup } from '@/features/setup/setup-state';
import { motionMs } from '@/state/motion';
import { CoreProgressLine } from './CoreProgressLine';
import { OnboardingArrow } from './OnboardingArrow';
import { OnboardingEdgeGlow } from './OnboardingEdgeGlow';
import { OnboardingExtraContent } from './OnboardingExtras';
import { OnboardingHintCard } from './OnboardingHintCard';
import { OnboardingIntro } from './OnboardingIntro';
import { OnboardingRing } from './OnboardingRing';
import {
  createOnboardingController,
  dismissesPermanently,
  type IntroPhase,
  introPhaseAdvances,
} from './onboarding-controller';
import {
  arrowAnchors,
  arrowWorthDrawing,
  coversMostOfViewport,
  placeCard,
  type Size,
} from './onboarding-geometry';
import {
  ONBOARDING_STEPS,
  ONBOARDING_TOTAL,
  type OnboardingStep,
  type OnboardingView,
} from './onboarding-steps';
import { createTourTarget } from './use-tour-target';
import './onboarding.css';

export interface OnboardingProps {
  readonly coreReady: boolean;
  readonly coreDownloading: boolean;
  /** A metered connection is holding the automatic core download for the user's decision. */
  readonly coreDeferred: boolean;
  readonly coreError: string | undefined;
  readonly coreProgress:
    | {
        readonly loaded: number;
        readonly total: number;
        readonly phase?: 'downloading' | 'verifying' | 'installing';
      }
    | undefined;
  readonly onDownloadCore: () => void;
  readonly onContentChanged: () => Promise<void>;
  /** Shows a root screen: the tour switches between the search home and «Мои файлы». */
  readonly onNavigate: (view: OnboardingView) => void;
  /** Nothing of the tour or of the core download remains on screen. */
  readonly onClose: () => void;
}

/** How long each self-advancing intro phase stays (ms): greeting, welcome, core explanation. */
const INTRO_PHASE_MS: Readonly<Record<IntroPhase, number>> = {
  wait: 0,
  hello: 1_500,
  welcome: 4_200,
  core: 3_200,
  ready: 0,
};
/** The card needs this long to glide to its place before an arrow is drawn from it. */
const CARD_GLIDE_MS = 420;
/** The blur recedes and the intro leaves in about this long (matches onboarding.css). */
const LEAVE_MS = 520;

function reducedMotion(): boolean {
  return motionMs(1) === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function searchField(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>('.search-home textarea');
}

const FOCUSABLE = 'button:not([disabled]):not([tabindex="-1"]), a[href], [tabindex="0"]';

/**
 * The guided onboarding: the real app under a blur, a greeting, the core download on a thin line
 * along the bottom edge, then a tour of the app's controls with a living edge glow, a floating
 * hint card and hand-drawn arrows. It replaces the old first-run setup screen.
 */
export function Onboarding(props: OnboardingProps): JSX.Element {
  const controller = createOnboardingController(ONBOARDING_STEPS.length);
  const state = controller.state;
  // Whether the core still has to arrive decides if the progress line is shown at all.
  const startedWithoutCore = !props.coreReady;
  const [active, setActive] = createSignal(true);
  const [leaving, setLeaving] = createSignal(false);
  const [introMounted, setIntroMounted] = createSignal(true);
  const [introLeaving, setIntroLeaving] = createSignal(false);
  const [flying, setFlying] = createSignal(false);
  const [pulseKey, setPulseKey] = createSignal(0);
  const [cardSize, setCardSize] = createSignal<Size>();
  const [viewport, setViewport] = createSignal<Size>({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [lineGone, setLineGone] = createSignal(!startedWithoutCore);
  const [animated, setAnimated] = createSignal(!reducedMotion());
  let root: HTMLDivElement | undefined;
  let introGone: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(introGone));

  const introPhase = (): IntroPhase => {
    const current = state();
    return current.kind === 'intro' ? current.phase : 'ready';
  };
  const touring = () => state().kind === 'tour';
  const step = (): OnboardingStep | undefined => {
    const current = state();
    return current.kind === 'tour' ? ONBOARDING_STEPS[current.index] : undefined;
  };
  const canGoBack = (): boolean => {
    const current = state();
    return current.kind === 'tour' && current.index > 0;
  };
  const stepNumber = () => {
    const current = state();
    return current.kind === 'tour' ? current.index + 2 : 1;
  };

  // ---- the page behind: inert while the tour is up, and a tour that is only a veil on top ----
  createEffect(() => {
    if (!active()) return;
    const app = document.getElementById('root');
    app?.setAttribute('inert', '');
    onCleanup(() => app?.removeAttribute('inert'));
  });
  onMount(() => {
    const resize = (): void => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', resize, { passive: true });
    onCleanup(() => window.removeEventListener('resize', resize));
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motionChanged = (): void => {
      setAnimated(!reducedMotion());
    };
    motionQuery.addEventListener('change', motionChanged);
    onCleanup(() => motionQuery.removeEventListener('change', motionChanged));
    // Nothing starts before the splash is gone, so the greeting never plays under it.
    let disposed = false;
    onCleanup(() => {
      disposed = true;
    });
    void afterBootReveal().then(() => {
      if (disposed) return;
      controller.send({ type: 'start' });
      root?.querySelector<HTMLElement>('.onboarding-intro')?.focus({ preventScroll: true });
    });
  });

  // ---- intro phases advance by timer; the greeting is skipped when animations are off ----
  createEffect(() => {
    const current = state();
    if (current.kind !== 'intro' || !introPhaseAdvances(current.phase)) return;
    const duration = current.phase === 'hello' && !animated() ? 0 : INTRO_PHASE_MS[current.phase];
    const timer = setTimeout(() => controller.send({ type: 'advance' }), duration);
    onCleanup(() => clearTimeout(timer));
  });

  // ---- the tour: switch screens, flare the glow, follow the control ----
  let shownView: OnboardingView | undefined;
  createEffect(
    on(step, (current) => {
      if (!current) return;
      if (current.pulse) setPulseKey((key) => key + 1);
      if (current.view !== shownView) {
        shownView = current.view;
        props.onNavigate(current.view);
      }
      if (current.targets.length === 0) {
        window.scrollTo({ top: 0, behavior: animated() ? 'smooth' : 'auto' });
      }
    }),
  );
  const target = createTourTarget(
    () => step()?.targets ?? [],
    () => (step()?.targets.length ?? 0) > 0,
  );
  const placement = createMemo(() => {
    const size = cardSize();
    return step() && size ? placeCard(viewport(), target()?.rect, size) : undefined;
  });
  const anchors = createMemo(() => {
    const spot = placement();
    const size = cardSize();
    const found = target();
    if (!spot || !size || !found || coversMostOfViewport(found.rect, viewport())) return undefined;
    const points = arrowAnchors({ left: spot.left, top: spot.top, ...size }, found.rect);
    return arrowWorthDrawing(points.from, points.to) ? points : undefined;
  });
  const ringed = () => {
    const found = target();
    return found && !coversMostOfViewport(found.rect, viewport()) ? found : undefined;
  };

  // ---- moving on: «Далее» from the intro flies into the card where the browser can animate it ----
  const startTour = (button: HTMLElement | undefined): void => {
    const begin = (): void => {
      controller.send({ type: 'next' });
      setIntroMounted(false);
    };
    if (button && !reducedMotion() && typeof document.startViewTransition === 'function') {
      setFlying(true);
      button.style.viewTransitionName = 'onboarding-next';
      // Rendering is suspended while the update callback runs, so no frame (and no
      // ResizeObserver) can come before the new state is captured: measure the card here.
      const transition = document.startViewTransition(() => {
        begin();
        const card = root?.querySelector<HTMLElement>('.onboarding-hint');
        if (card) setCardSize({ width: card.offsetWidth, height: card.offsetHeight });
      });
      transition.finished
        .catch((cause: unknown) => {
          console.warn('Переход кнопки «Далее» в карточку не сыграл.', cause);
        })
        .finally(() => {
          button.style.viewTransitionName = '';
          setFlying(false);
        });
      return;
    }
    controller.send({ type: 'next' });
    setIntroLeaving(true);
    introGone = setTimeout(() => setIntroMounted(false), Math.max(60, motionMs(260)));
  };
  const next = (button?: HTMLElement): void => {
    const current = state();
    if (current.kind === 'intro' && current.phase === 'ready') startTour(button);
    else controller.send({ type: 'next' });
  };
  const skip = (): void => controller.send({ type: 'skip' });

  // ---- the end: fade out, return to search, remember the outcome ----
  const closeIfFinished = (): void => {
    if (!active() && lineGone()) props.onClose();
  };
  createEffect(
    on(
      () => {
        const current = state();
        return current.kind === 'done' ? current.reason : undefined;
      },
      (reason) => {
        if (!reason) return;
        if (dismissesPermanently(props.coreReady)) dismissSetup();
        props.onNavigate('search');
        setLeaving(true);
        const fade = setTimeout(
          () => {
            setActive(false);
            // A touch screen would raise the keyboard; keyboard and mouse users get the field.
            if (window.matchMedia('(pointer: fine)').matches) {
              searchField()?.focus({ preventScroll: true });
            }
            closeIfFinished();
          },
          Math.max(60, motionMs(LEAVE_MS)),
        );
        onCleanup(() => clearTimeout(fade));
      },
      { defer: true },
    ),
  );
  // The core arrived after the tour ended early: from now on the tour never returns.
  createEffect(() => {
    if (state().kind === 'done' && props.coreReady && dismissesPermanently(true)) dismissSetup();
  });
  createEffect(on(lineGone, closeIfFinished, { defer: true }));

  // ---- keyboard: Enter/→ next, ← back, Esc skip, Tab stays inside the tour ----
  onMount(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!active() || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey)
        return;
      const onControl = (event.target as Element | null)?.closest(
        'button, a, input, textarea, select',
      );
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          skip();
          return;
        case 'ArrowRight':
          event.preventDefault();
          next();
          return;
        case 'ArrowLeft':
          event.preventDefault();
          controller.send({ type: 'back' });
          return;
        case 'Enter':
          if (!onControl) {
            event.preventDefault();
            next();
          }
          return;
        case 'Tab': {
          const items = Array.from(root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
            (item) => item.offsetParent !== null || item.getClientRects().length > 0,
          );
          const first = items[0];
          const last = items[items.length - 1];
          if (!first || !last) {
            event.preventDefault();
            return;
          }
          const focused = document.activeElement;
          if (event.shiftKey && (focused === first || !root?.contains(focused))) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && (focused === last || !root?.contains(focused))) {
            event.preventDefault();
            first.focus();
          }
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  return (
    <>
      <Show when={active()}>
        <Portal>
          <div
            ref={(element) => {
              root = element;
            }}
            class="onboarding"
            classList={{
              'onboarding--tour': touring(),
              'onboarding--leaving': leaving(),
              'onboarding--flying': flying(),
            }}
          >
            <div class="onboarding__veil onboarding__veil--full" aria-hidden="true" />
            <div class="onboarding__veil onboarding__veil--edge" aria-hidden="true" />
            <div class="onboarding__edge-light" aria-hidden="true" />
            <Show when={touring() && pulseKey() > 0 && animated()}>
              <Show when={pulseKey()} keyed>
                {(key) => (
                  <div class="onboarding__edge-flare" data-pulse={key} aria-hidden="true" />
                )}
              </Show>
            </Show>
            <Show when={touring() && animated()}>
              <OnboardingEdgeGlow pulseKey={pulseKey()} />
            </Show>

            <Show when={introMounted()}>
              <div
                class="onboarding__intro-layer"
                classList={{ 'onboarding__intro-layer--leaving': introLeaving() }}
              >
                <OnboardingIntro
                  phase={introPhase()}
                  coreReady={props.coreReady}
                  coreDeferred={props.coreDeferred && !props.coreDownloading}
                  coreError={props.coreError}
                  onNext={(button) => next(button)}
                  onSkip={skip}
                  onDownloadCore={props.onDownloadCore}
                />
              </div>
            </Show>

            <Show when={step()} keyed>
              {(marked) => (
                <div class="onboarding__marks" data-step={marked.id}>
                  <Show when={ringed()}>
                    {(found) => <OnboardingRing rect={found().rect} radius={found().radius} />}
                  </Show>
                  <Show when={anchors()}>
                    {(points) => (
                      <OnboardingArrow
                        from={points().from}
                        to={points().to}
                        seed={stepNumber()}
                        delayMs={CARD_GLIDE_MS}
                      />
                    )}
                  </Show>
                </div>
              )}
            </Show>
            <Show when={step()}>
              {(current) => (
                <OnboardingHintCard
                  step={current()}
                  position={stepNumber()}
                  total={ONBOARDING_TOTAL}
                  placement={placement()}
                  coreReady={props.coreReady}
                  canGoBack={canGoBack()}
                  instant={flying()}
                  onSize={setCardSize}
                  onBack={() => controller.send({ type: 'back' })}
                  onNext={() => next()}
                  onSkip={skip}
                >
                  <Show when={current().extra} keyed>
                    {(extra) => (
                      <OnboardingExtraContent
                        kind={extra}
                        onContentChanged={props.onContentChanged}
                      />
                    )}
                  </Show>
                </OnboardingHintCard>
              )}
            </Show>
          </div>
        </Portal>
      </Show>
      <Show when={startedWithoutCore}>
        <CoreProgressLine
          ready={props.coreReady}
          downloading={props.coreDownloading}
          deferred={props.coreDeferred}
          error={props.coreError}
          progress={props.coreProgress}
          onDownload={props.onDownloadCore}
          onGone={() => setLineGone(true)}
        />
      </Show>
    </>
  );
}
