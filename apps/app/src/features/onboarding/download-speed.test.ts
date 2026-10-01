import { describe, expect, it } from 'vitest';
import {
  currentSpeed,
  formatSpeed,
  nextSpeed,
  SPEED_MIN_INTERVAL_MS,
  SPEED_STALL_MS,
  startSpeed,
} from './download-speed';

const MIB = 1024 * 1024;

describe('download speed', () => {
  it('has no speed after the first sample', () => {
    expect(startSpeed(0, 0).speed).toBeUndefined();
  });

  it('takes the first delta as is', () => {
    const state = nextSpeed(startSpeed(0, 0), 1000, 4 * MIB);
    expect(state.speed).toBeCloseTo(4 * MIB, 0);
  });

  it('smooths a burst instead of jumping to it', () => {
    let state = nextSpeed(startSpeed(0, 0), 1000, 4 * MIB);
    state = nextSpeed(state, 2000, 12 * MIB);
    const speed = state.speed ?? 0;
    expect(speed).toBeGreaterThan(4 * MIB);
    expect(speed).toBeLessThan(8 * MIB);
  });

  it('settles on a steady rate', () => {
    let state = startSpeed(0, 0);
    for (let second = 1; second <= 30; second += 1) {
      state = nextSpeed(state, second * 1000, second * 2 * MIB);
    }
    expect(state.speed).toBeCloseTo(2 * MIB, -3);
  });

  it('folds samples that arrive too quickly into the next one', () => {
    const first = nextSpeed(startSpeed(0, 0), 1000, MIB);
    const same = nextSpeed(first, 1000 + SPEED_MIN_INTERVAL_MS - 1, 2 * MIB);
    expect(same).toBe(first);
    const later = nextSpeed(first, 1000 + SPEED_MIN_INTERVAL_MS, 2 * MIB);
    expect(later.loaded).toBe(2 * MIB);
  });

  it('starts again when the byte count goes backwards', () => {
    const running = nextSpeed(startSpeed(0, 0), 1000, 10 * MIB);
    const restarted = nextSpeed(running, 2000, MIB);
    expect(restarted).toEqual({ at: 2000, loaded: MIB, speed: undefined });
  });

  it('reports no speed once the transfer has stalled', () => {
    const state = nextSpeed(startSpeed(0, 0), 1000, MIB);
    expect(currentSpeed(state, 1000 + SPEED_STALL_MS)).toBeDefined();
    expect(currentSpeed(state, 1000 + SPEED_STALL_MS + 1)).toBeUndefined();
  });

  it('formats speeds in Russian units with a decimal comma', () => {
    expect(formatSpeed(4.2 * MIB)).toBe('4,2 МБ/с');
    expect(formatSpeed(12.4 * MIB)).toBe('12 МБ/с');
    expect(formatSpeed(850 * 1024)).toBe('850 КБ/с');
    expect(formatSpeed(10)).toBe('1 КБ/с');
  });
});
