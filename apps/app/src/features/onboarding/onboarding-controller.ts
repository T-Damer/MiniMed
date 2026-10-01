import { type Accessor, createSignal } from 'solid-js';

/**
 * The tour as a state machine: intro phases, then the steps, then done. The reducer is pure so
 * it runs without a DOM; {@link createOnboardingController} wraps it in a signal.
 */

/** `wait`: the splash is still leaving; `hello`..`ready`: the full-screen intro (step 1). */
export type IntroPhase = 'wait' | 'hello' | 'welcome' | 'core' | 'ready';

export type OnboardingState =
  | { readonly kind: 'intro'; readonly phase: IntroPhase }
  | { readonly kind: 'tour'; readonly index: number }
  | { readonly kind: 'done'; readonly reason: 'finished' | 'skipped' };

export type OnboardingEvent =
  /** The splash is gone: the greeting may begin. */
  | { readonly type: 'start' }
  /** A timer or the keyboard moves the intro on one phase; ignored once the intro is over. */
  | { readonly type: 'advance' }
  | { readonly type: 'next' }
  | { readonly type: 'back' }
  | { readonly type: 'skip' };

const INTRO_ORDER: readonly IntroPhase[] = ['wait', 'hello', 'welcome', 'core', 'ready'];

export function initialOnboardingState(): OnboardingState {
  return { kind: 'intro', phase: 'wait' };
}

/** Intro phases that a timer moves on by itself (the last one waits for the user). */
export function introPhaseAdvances(phase: IntroPhase): boolean {
  return phase === 'hello' || phase === 'welcome' || phase === 'core';
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
      case 'advance':
        if (state.phase === 'wait' || state.phase === 'ready') return state;
        return { kind: 'intro', phase: INTRO_ORDER[position + 1] ?? 'ready' };
      case 'next':
        if (state.phase === 'wait') return state;
        // «Далее» from the last intro phase begins the tour; earlier it skips ahead one phase.
        if (state.phase === 'ready') {
          return stepCount > 0 ? { kind: 'tour', index: 0 } : { kind: 'done', reason: 'finished' };
        }
        return { kind: 'intro', phase: INTRO_ORDER[position + 1] ?? 'ready' };
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
