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
import { dismissSetup, releaseCoreStart } from '@/features/setup/setup-state';
import { motionMs } from '@/state/motion';
import { CoreProgressLine } from './CoreProgressLine';
import { OnboardingArrow } from './OnboardingArrow';
import { OnboardingExtraContent } from './OnboardingExtras';
import { OnboardingHintCard } from './OnboardingHintCard';
import { OnboardingIntro } from './OnboardingIntro';
import { OnboardingRing } from './OnboardingRing';
import {
  coreDownloadMayStart,
  createOnboardingController,
  dismissesPermanently,
  type IntroPhase,
  LAST_INTRO_PHASE,
} from './onboarding-controller';
import {
  ARROW_OUTSET,
  arrowAnchors,
  arrowWorthDrawing,
  coversMostOfViewport,
  placeCard,
  type Size,
  scrollDeltaToFit,
} from './onboarding-geometry';
import { registerOnboardingHandOff, setOnboardingOnScreen } from './onboarding-state';
import {
  ONBOARDING_STEPS,
  ONBOARDING_TOTAL,
  type OnboardingStep,
  type OnboardingView,
} from './onboarding-steps';
import { readSafeInsets, type SafeInsets, usableSize } from './safe-insets';
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

/** The card needs this long to glide to its place before an arrow is drawn from it. */
const CARD_GLIDE_MS = 420;
/** Height of the bottom strip kept free for the core progress label (px), above the bottom inset. */
const BOTTOM_STRIP = 44;
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
 * along the bottom edge, then a tour of the app's controls with a floating
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
  const [cardSize, setCardSize] = createSignal<Size>();
  const [viewport, setViewport] = createSignal<Size>({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [lineGone, setLineGone] = createSignal(!startedWithoutCore);
  const [animated, setAnimated] = createSignal(!reducedMotion());
  const [insets, setInsets] = createSignal<SafeInsets>({ top: 0, bottom: 0 });
  let root: HTMLDivElement | undefined;
  let introGone: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(introGone));

  const introPhase = (): IntroPhase => {
    const current = state();
    return current.kind === 'intro' ? current.phase : LAST_INTRO_PHASE;
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

  // ---- the core download waits for the user to get past the greeting and the welcome ----
  createEffect(() => {
    if (coreDownloadMayStart(state())) releaseCoreStart();
  });
  onCleanup(releaseCoreStart);

  // ---- while on screen: the page holds still, and notices slip under the tour ----
  createEffect(() => {
    if (!active()) return;
    setOnboardingOnScreen(true);
    document.documentElement.dataset['onboarding'] = 'open';
    onCleanup(() => {
      setOnboardingOnScreen(false);
      delete document.documentElement.dataset['onboarding'];
    });
  });

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
      setInsets(readSafeInsets());
    };
    setInsets(readSafeInsets());
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
    const begin = (): void => {
      controller.send({ type: 'start' });
      root?.querySelector<HTMLElement>('.onboarding-intro')?.focus({ preventScroll: true });
    };
    // First launch: the boot surface hands over to the intro instead of revealing search. The
    // splash icon (named in the old state) flies onto the intro's icon (named in the new one),
    // and in the same frame the surface goes and the greeting begins. Ground to blurred app is
    // the root cross-fade. Without the API, or with animations off, the shell fades the surface
    // over the already blurred intro.
    onCleanup(
      registerOnboardingHandOff(async (removeSurface) => {
        const icon = root?.querySelector<HTMLElement>('.onboarding-intro__mark');
        const splashIcon = document.querySelector<HTMLElement>('.boot-surface__icon');
        if (
          !icon ||
          !splashIcon ||
          reducedMotion() ||
          typeof document.startViewTransition !== 'function'
        ) {
          begin();
          return false;
        }
        splashIcon.style.viewTransitionName = 'minimed-boot-icon';
        const transition = document.startViewTransition(() => {
          icon.style.viewTransitionName = 'minimed-boot-icon';
          removeSurface();
          begin();
        });
        transition.finished
          .catch((cause: unknown) => {
            console.warn('Полёт значка с заставки в приветствие не сыграл.', cause);
          })
          .finally(() => {
            icon.style.viewTransitionName = '';
          });
        await transition.updateCallbackDone;
        return true;
      }),
    );
    // Later runs (Settings → replay) have no surface: start as soon as there is none.
    void afterBootReveal().then(() => {
      if (!disposed) begin();
    });
  });

  // ---- the tour: switch screens, follow the control ----
  let shownView: OnboardingView | undefined;
  createEffect(
    on(step, (current) => {
      if (!current) return;
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
    if (!step() || !size) return undefined;
    // The status bar above and the gesture bar below are not the tour's to cover, and the strip
    // along the bottom edge belongs to the core progress label: place the card in what is left.
    const inset = insets();
    const free = { top: inset.top, bottom: inset.bottom + BOTTOM_STRIP };
    const found = target();
    const spot = placeCard(
      usableSize(viewport(), free),
      found ? { ...found.rect, top: found.rect.top - free.top } : undefined,
      size,
    );
    return { ...spot, top: spot.top + free.top };
  });
  // The card needs a side to stand on: when the highlighted control sits where neither side has
  // room (a card in the middle of the home page), the page is scrolled just far enough. Waits for
  // the target, the card and any scrolling already under way to settle, and tries a few times only.
  let fitAttempts = 0;
  createEffect(
    on(step, () => {
      fitAttempts = 0;
    }),
  );
  createEffect(() => {
    const found = target();
    const size = cardSize();
    if (!step() || !size || !found || found.pinned) return;
    // Track what the settle timer depends on, so any change restarts it.
    const { left, top, width, height } = found.rect;
    const here = viewport();
    const inset = insets();
    const settle = setTimeout(() => {
      if (fitAttempts >= 3 || coversMostOfViewport(found.rect, here)) return;
      const free = { top: inset.top, bottom: inset.bottom + BOTTOM_STRIP };
      const delta = scrollDeltaToFit(
        usableSize(here, free),
        { left, top: top - free.top, width, height },
        size,
      );
      if (delta === 0) return;
      fitAttempts += 1;
      window.scrollBy({ top: delta, behavior: animated() ? 'smooth' : 'auto' });
    }, 450);
    onCleanup(() => clearTimeout(settle));
  });
  const anchors = createMemo(() => {
    const spot = placement();
    const size = cardSize();
    const found = target();
    if (!spot || !size || !found || coversMostOfViewport(found.rect, viewport())) return undefined;
    const points = arrowAnchors(
      { left: spot.left, top: spot.top, ...size },
      found.rect,
      ARROW_OUTSET,
    );
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
    if (current.kind === 'intro' && current.phase === LAST_INTRO_PHASE) startTour(button);
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
                    {(found) => (
                      <OnboardingRing
                        rect={found().rect}
                        radius={found().radius}
                        spotlight={marked.spotlight === true}
                      />
                    )}
                  </Show>
                  <Show when={anchors()}>
                    {(points) => (
                      <OnboardingArrow
                        from={points().from}
                        to={points().to}
                        seed={stepNumber()}
                        width={viewport().width}
                        height={viewport().height}
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
          waiting={!coreDownloadMayStart(state())}
          compact={active()}
          onDownload={props.onDownloadCore}
          onGone={() => setLineGone(true)}
        />
      </Show>
    </>
  );
}
