import { describe, expect, it } from 'vitest';

import {
  initialKeyboardTracker,
  isTextEntry,
  KEYBOARD_CLOSE_GRACE_MS,
  KEYBOARD_MIN_SHRINK_PX,
  type KeyboardTrackerInput,
  type KeyboardTrackerState,
  revealDelta,
  stepKeyboardTracker,
} from '@/app/soft-keyboard';

const FULL = 780;
const WITH_KEYBOARD = FULL - 320;

function observe(
  state: KeyboardTrackerState,
  input: Partial<KeyboardTrackerInput>,
): ReturnType<typeof stepKeyboardTracker> {
  return stepKeyboardTracker(state, {
    focused: false,
    viewportHeight: FULL,
    viewportWidth: 375,
    coarsePointer: true,
    now: 0,
    ...input,
  });
}

describe('isTextEntry', () => {
  it('accepts text fields, text areas and editable regions', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTextEntry({ tagName: 'input', type: 'text' })).toBe(true);
    expect(isTextEntry({ tagName: 'INPUT' })).toBe(true);
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('rejects controls that do not open a keyboard', () => {
    for (const type of ['checkbox', 'radio', 'range', 'button', 'file', 'color', 'submit']) {
      expect(isTextEntry({ tagName: 'INPUT', type })).toBe(false);
    }
    expect(isTextEntry({ tagName: 'INPUT', type: 'text', readOnly: true })).toBe(false);
    expect(isTextEntry({ tagName: 'TEXTAREA', disabled: true })).toBe(false);
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false);
    expect(isTextEntry({ tagName: 'DIV' })).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe('stepKeyboardTracker', () => {
  it('keeps the navigation out of the way as soon as a field is focused on a touch device', () => {
    const start = initialKeyboardTracker(FULL, 375);
    expect(observe(start, { focused: false }).hidden).toBe(false);
    expect(observe(start, { focused: true }).hidden).toBe(true);
  });

  it('leaves the navigation alone when a field is focused with a mouse and the viewport is intact', () => {
    const start = initialKeyboardTracker(FULL, 375);
    expect(observe(start, { focused: true, coarsePointer: false }).hidden).toBe(false);
  });

  it('hides it for a visibly shorter viewport even without a touch screen', () => {
    const start = initialKeyboardTracker(FULL, 375);
    const step = observe(start, {
      focused: true,
      coarsePointer: false,
      viewportHeight: WITH_KEYBOARD,
    });
    expect(step.hidden).toBe(true);
  });

  it('ignores a browser bar sized change', () => {
    const start = initialKeyboardTracker(FULL, 375);
    const step = observe(start, {
      focused: false,
      viewportHeight: FULL - (KEYBOARD_MIN_SHRINK_PX - 1),
    });
    expect(step.hidden).toBe(false);
  });

  it('holds the navigation back while the keyboard closes, then lets it return', () => {
    let state = initialKeyboardTracker(FULL, 375);
    state = observe(state, { focused: true, viewportHeight: WITH_KEYBOARD, now: 0 }).state;
    // Focus left the field but the viewport has not grown back yet.
    const closing = observe(state, { focused: false, viewportHeight: WITH_KEYBOARD, now: 100 });
    expect(closing.hidden).toBe(true);
    // The viewport is back to full height.
    const closed = observe(closing.state, { focused: false, viewportHeight: FULL, now: 300 });
    expect(closed.hidden).toBe(false);
    expect(closed.state.referenceHeight).toBe(FULL);
  });

  it('accepts a short viewport without a focused field as the new normal after the grace', () => {
    let state = initialKeyboardTracker(FULL, 375);
    state = observe(state, { focused: true, viewportHeight: WITH_KEYBOARD, now: 0 }).state;
    const first = observe(state, { focused: false, viewportHeight: WITH_KEYBOARD, now: 100 });
    expect(first.hidden).toBe(true);
    const later = observe(first.state, {
      focused: false,
      viewportHeight: WITH_KEYBOARD,
      now: 100 + KEYBOARD_CLOSE_GRACE_MS + 1,
    });
    expect(later.hidden).toBe(false);
    expect(later.state.referenceHeight).toBe(WITH_KEYBOARD);
  });

  it('measures afresh after a rotation instead of reading it as a keyboard', () => {
    const portrait = initialKeyboardTracker(FULL, 375);
    const landscape = observe(portrait, {
      focused: false,
      viewportHeight: 375,
      viewportWidth: 780,
      now: 10,
    });
    expect(landscape.hidden).toBe(false);
    expect(landscape.state.referenceHeight).toBe(375);
    expect(landscape.state.referenceWidth).toBe(780);
  });
});

describe('revealDelta', () => {
  const visible = { top: 24, bottom: 480 };

  it('does nothing for a field that is already in view', () => {
    expect(revealDelta({ top: 100, bottom: 148 }, visible, 16)).toBe(0);
  });

  it('scrolls a field hidden behind the keyboard into view', () => {
    expect(revealDelta({ top: 500, bottom: 548 }, visible, 16)).toBe(548 - 464);
  });

  it('scrolls back a field above the visible area', () => {
    expect(revealDelta({ top: 10, bottom: 58 }, visible, 16)).toBe(10 - 40);
  });

  it('keeps the top of a field taller than the free space reachable', () => {
    expect(revealDelta({ top: 200, bottom: 900 }, visible, 16)).toBe(0);
    expect(revealDelta({ top: 20, bottom: 900 }, visible, 16)).toBe(20 - 40);
  });
});
