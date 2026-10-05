import { type Accessor, createSignal } from 'solid-js';

/**
 * The tour as a state machine: intro phases, then the steps, then done. The reducer is pure so
 * it runs without a DOM; {@link createOnboardingController} wraps it in a signal.
 */

/**
 * `wait`: the splash is still leaving; `hello`: the logo and the greeting; `welcome`: a few words
 * about the app; `core`: the core download (the last phase, whose «Далее» begins the tour).
 * Nothing moves on by itself: every phase waits for the user.
 */
export type IntroPhase = 'wait' | 'hello' | 'welcome' | 'core';

export type OnboardingState =
  | { readonly kind: 'intro'; readonly phase: IntroPhase }
  | { readonly kind: 'tour'; readonly index: number }
  | { readonly kind: 'done'; readonly reason: 'finished' | 'skipped' };

export type OnboardingEvent =
  /** The splash is gone: the greeting may begin. */
  | { readonly type: 'start' }
  | { readonly type: 'next' }
  | { readonly type: 'back' }
  | { readonly type: 'skip' };

const INTRO_ORDER: readonly IntroPhase[] = ['wait', 'hello', 'welcome', 'core'];

export function initialOnboardingState(): OnboardingState {
  return { kind: 'intro', phase: 'wait' };
}

/** The intro phase from which «Далее» begins the tour. */
export const LAST_INTRO_PHASE: IntroPhase = 'core';

/** From this phase on the core download may begin: the user has read what it is and gone on. */
export function coreDownloadMayStart(state: OnboardingState): boolean {
  return state.kind !== 'intro' || state.phase === 'core';
}

export function reduceOnboarding(
  state: OnboardingState,
  event: OnboardingEvent,
  stepCount: number,
): OnboardingState {
  if (state.kind === 'done') return state;
  if (event.type === 'skip') return { kind: 'done', reason: 'skipped' };
  if (state.kind === 'intro') {
    const position = INTRO_ORDER.indexOf(state.phase);
    switch (event.type) {
      case 'start':
        return state.phase === 'wait' ? { kind: 'intro', phase: 'hello' } : state;
      case 'next':
        if (state.phase === 'wait') return state;
        // «Далее» from the last intro phase begins the tour; earlier it shows the next phase.
        if (state.phase === LAST_INTRO_PHASE) {
          return stepCount > 0 ? { kind: 'tour', index: 0 } : { kind: 'done', reason: 'finished' };
        }
        return { kind: 'intro', phase: INTRO_ORDER[position + 1] ?? LAST_INTRO_PHASE };
      case 'back':
        return state;
    }
  }
  switch (event.type) {
    case 'next':
      return state.index + 1 >= stepCount
        ? { kind: 'done', reason: 'finished' }
        : { kind: 'tour', index: state.index + 1 };
    case 'back':
      return state.index > 0 ? { kind: 'tour', index: state.index - 1 } : state;
    default:
      return state;
  }
}

/**
 * Finishing or skipping hides the tour for good only once the core is installed; before that it
 * hides for this session and returns on the next launch, as the old setup screen did.
 */
export function dismissesPermanently(coreReady: boolean): boolean {
  return coreReady;
}

export interface OnboardingController {
  readonly state: Accessor<OnboardingState>;
  readonly send: (event: OnboardingEvent) => void;
}

export function createOnboardingController(stepCount: number): OnboardingController {
  const [state, setState] = createSignal<OnboardingState>(initialOnboardingState());
  return {
    state,
    send: (event) => setState((current) => reduceOnboarding(current, event, stepCount)),
  };
}
