import { describe, expect, it } from 'vitest';
import {
  createOnboardingController,
  dismissesPermanently,
  initialOnboardingState,
  introPhaseAdvances,
  type OnboardingEvent,
  type OnboardingState,
  reduceOnboarding,
} from './onboarding-controller';
import { ONBOARDING_STEPS, ONBOARDING_TOTAL } from './onboarding-steps';

const COUNT = 3;

function run(events: readonly OnboardingEvent[], from = initialOnboardingState()) {
  return events.reduce<OnboardingState>(
    (state, event) => reduceOnboarding(state, event, COUNT),
    from,
  );
}

describe('onboarding controller', () => {
  it('waits for the splash, then greets', () => {
    expect(initialOnboardingState()).toEqual({ kind: 'intro', phase: 'wait' });
    expect(run([{ type: 'advance' }, { type: 'next' }])).toEqual({ kind: 'intro', phase: 'wait' });
    expect(run([{ type: 'start' }])).toEqual({ kind: 'intro', phase: 'hello' });
  });

  it('walks the intro phases by timer and stops at the button', () => {
    const phases: string[] = [];
    let state: OnboardingState = run([{ type: 'start' }]);
    for (let turn = 0; turn < 5; turn += 1) {
      if (state.kind === 'intro') phases.push(state.phase);
      state = reduceOnboarding(state, { type: 'advance' }, COUNT);
    }
    expect(phases).toEqual(['hello', 'welcome', 'core', 'ready', 'ready']);
    expect(introPhaseAdvances('hello')).toBe(true);
    expect(introPhaseAdvances('ready')).toBe(false);
  });

  it('lets «Далее» skip ahead through the intro and then start the tour', () => {
    const state = run([{ type: 'start' }, { type: 'next' }, { type: 'next' }, { type: 'next' }]);
    expect(state).toEqual({ kind: 'intro', phase: 'ready' });
    expect(reduceOnboarding(state, { type: 'next' }, COUNT)).toEqual({ kind: 'tour', index: 0 });
  });

  it('moves through the steps and finishes on the last one', () => {
    let state: OnboardingState = { kind: 'tour', index: 0 };
    state = reduceOnboarding(state, { type: 'next' }, COUNT);
    expect(state).toEqual({ kind: 'tour', index: 1 });
    state = reduceOnboarding(state, { type: 'next' }, COUNT);
    expect(state).toEqual({ kind: 'tour', index: 2 });
    expect(reduceOnboarding(state, { type: 'next' }, COUNT)).toEqual({
      kind: 'done',
      reason: 'finished',
    });
  });

  it('goes back but never before the first step or out of the tour', () => {
    expect(run([{ type: 'back' }], { kind: 'tour', index: 2 })).toEqual({ kind: 'tour', index: 1 });
    expect(run([{ type: 'back' }], { kind: 'tour', index: 0 })).toEqual({ kind: 'tour', index: 0 });
    expect(run([{ type: 'start' }, { type: 'back' }])).toEqual({ kind: 'intro', phase: 'hello' });
  });

  it('skips from anywhere and stays done', () => {
    expect(run([{ type: 'skip' }])).toEqual({ kind: 'done', reason: 'skipped' });
    expect(run([{ type: 'skip' }], { kind: 'tour', index: 1 })).toEqual({
      kind: 'done',
      reason: 'skipped',
    });
    const done: OnboardingState = { kind: 'done', reason: 'finished' };
    expect(run([{ type: 'next' }, { type: 'back' }, { type: 'skip' }], done)).toBe(done);
  });

  it('dismisses for good only when the core is installed', () => {
    expect(dismissesPermanently(true)).toBe(true);
    expect(dismissesPermanently(false)).toBe(false);
  });

  it('wraps the reducer in a signal', () => {
    const controller = createOnboardingController(COUNT);
    controller.send({ type: 'start' });
    expect(controller.state()).toEqual({ kind: 'intro', phase: 'hello' });
    controller.send({ type: 'skip' });
    expect(controller.state()).toEqual({ kind: 'done', reason: 'skipped' });
  });
});

describe('onboarding steps', () => {
  it('counts the intro as the first of nine steps', () => {
    expect(ONBOARDING_TOTAL).toBe(9);
  });

  it('has unique ids, a title and text for every step', () => {
    expect(new Set(ONBOARDING_STEPS.map((step) => step.id)).size).toBe(ONBOARDING_STEPS.length);
    for (const step of ONBOARDING_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.paragraphs.length).toBeGreaterThan(0);
    }
  });

  it('ends on the step with the finishing button', () => {
    expect(ONBOARDING_STEPS.at(-1)?.finishLabel).toBe('Начать работу');
    expect(ONBOARDING_STEPS.slice(0, -1).every((step) => step.finishLabel === undefined)).toBe(
      true,
    );
  });
});
