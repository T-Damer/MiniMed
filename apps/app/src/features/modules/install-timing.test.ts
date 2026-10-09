import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  epochNow,
  INSTALL_MEASURE_PREFIX,
  markInstallState,
  recordEpochInstallPhase,
  recordInstallDuration,
  timeInstallPhase,
} from './install-timing';

function installMeasures(): readonly PerformanceEntry[] {
  return performance
    .getEntriesByType('measure')
    .filter((entry) => entry.name.startsWith(INSTALL_MEASURE_PREFIX));
}

afterEach(() => {
  performance.clearMeasures();
  performance.clearMarks();
  vi.restoreAllMocks();
});

describe('install timing', () => {
  it('records a measure around a phase, also when the phase fails', async () => {
    await expect(timeInstallPhase('ok', async () => 7)).resolves.toBe(7);
    await expect(
      timeInstallPhase('failing', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(installMeasures().map((entry) => entry.name)).toEqual([
      `${INSTALL_MEASURE_PREFIX}ok`,
      `${INSTALL_MEASURE_PREFIX}failing`,
    ]);
  });

  it('re-bases a worker phase onto the main thread clock', () => {
    const now = epochNow();
    recordEpochInstallPhase({ phase: 'import', startEpochMs: now - 50, endEpochMs: now - 20 });
    const [entry] = installMeasures();
    expect(entry?.name).toBe(`${INSTALL_MEASURE_PREFIX}import`);
    expect(entry?.duration).toBeCloseTo(30, 0);
    expect(entry?.startTime).toBeCloseTo(performance.now() - 50, -2);
  });

  it('lays a summed duration out from its start', () => {
    recordInstallDuration('decode', 100, 40);
    const [entry] = installMeasures();
    expect(entry?.startTime).toBe(100);
    expect(entry?.duration).toBe(40);
  });

  it('marks task states with the module id and never throws', () => {
    markInstallState('minimed.test', 'verifying');
    const [mark] = performance.getEntriesByName(`${INSTALL_MEASURE_PREFIX}state:verifying`);
    expect((mark as PerformanceMark | undefined)?.detail).toEqual({ moduleId: 'minimed.test' });
    vi.spyOn(performance, 'mark').mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(() => markInstallState('minimed.test', 'completed')).not.toThrow();
  });
});
