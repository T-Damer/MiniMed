import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLingerController,
  skeletonCardCount,
  skeletonColumnCount,
} from '@/features/search/search-skeleton';

describe('skeleton layout', () => {
  it('uses the result grid column rule', () => {
    expect(skeletonColumnCount(390)).toBe(1);
    expect(skeletonColumnCount(1280)).toBe(2);
  });

  it('fills two rows of cards', () => {
    expect(skeletonCardCount(1)).toBe(2);
    expect(skeletonCardCount(2)).toBe(4);
  });
});

describe('createLingerController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays mounted for the linger time after the source turns inactive', () => {
    const states: boolean[] = [];
    const controller = createLingerController(
      (mounted) => states.push(mounted),
      () => 200,
    );
    controller.update(true);
    controller.update(false);
    expect(states).toEqual([true]);
    vi.advanceTimersByTime(199);
    expect(states).toEqual([true]);
    vi.advanceTimersByTime(2);
    expect(states).toEqual([true, false]);
  });

  it('cancels the pending unmount when the source turns active again', () => {
    const states: boolean[] = [];
    const controller = createLingerController(
      (mounted) => states.push(mounted),
      () => 200,
    );
    controller.update(true);
    controller.update(false);
    vi.advanceTimersByTime(100);
    controller.update(true);
    vi.advanceTimersByTime(500);
    expect(states).toEqual([true, true]);
  });

  it('unmounts at once when animations are off', () => {
    const states: boolean[] = [];
    const controller = createLingerController(
      (mounted) => states.push(mounted),
      () => 0,
    );
    controller.update(true);
    controller.update(false);
    expect(states).toEqual([true, false]);
  });

  it('drops the pending unmount on dispose', () => {
    const states: boolean[] = [];
    const controller = createLingerController(
      (mounted) => states.push(mounted),
      () => 200,
    );
    controller.update(false);
    controller.dispose();
    vi.advanceTimersByTime(500);
    expect(states).toEqual([]);
  });
});
