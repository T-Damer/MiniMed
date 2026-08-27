import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createMedicalImagePressRepeat,
  medicalImagePointerAction,
  medicalImageSliceDragSteps,
  readBlobWithProgress,
  volumeCutawayPlanes,
} from '@/features/library/medical-image-utils';

afterEach(() => vi.useRealTimers());

describe('medical image loading', () => {
  it('reports completion and preserves the source bytes', async () => {
    const progress: number[] = [];
    const result = await readBlobWithProgress(
      new Blob([new Uint8Array([4, 8, 15, 16, 23, 42])]),
      (fraction) => progress.push(fraction),
    );

    expect([...new Uint8Array(result)]).toEqual([4, 8, 15, 16, 23, 42]);
    expect(progress.at(-1)).toBe(1);
  });

  it('places the three 3D cut planes at the crosshair', () => {
    expect(volumeCutawayPlanes([0.25, 0.25, 0.75])).toEqual([
      [-0.25, 90, 0],
      [-0.25, 180, 0],
      [-0.25, 0, -90],
    ]);
  });

  it('turns vertical drag distance into signed slice steps', () => {
    expect(medicalImageSliceDragSteps(100, 75, 10)).toBe(2);
    expect(medicalImageSliceDragSteps(100, 125, 10)).toBe(-2);
    expect(medicalImageSliceDragSteps(100, 94, 10)).toBe(0);
  });

  it('routes drag in a 3D render tile to cursor movement instead of viewer rotation', () => {
    expect(medicalImagePointerAction('render', true, false)).toBe('cursor');
    expect(medicalImagePointerAction('multiplanar', true, false)).toBe('cursor');
    expect(medicalImagePointerAction('render', true, false, false, true)).toBe('viewer');
    expect(medicalImagePointerAction('multiplanar', true, false, false, true, true)).toBe(
      'blocked',
    );
    expect(medicalImagePointerAction('axial', false, true)).toBe('slice');
    expect(medicalImagePointerAction('axial', false, true, true)).toBe('viewer');
    expect(medicalImagePointerAction('multiplanar', false, false)).toBe('viewer');
  });

  it('repeats held slice navigation and suppresses the release click', () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const repeat = createMedicalImagePressRepeat(action);

    repeat.start();
    vi.advanceTimersByTime(1_000);
    expect(action.mock.calls.length).toBeGreaterThan(1);
    repeat.stop();
    const repeatedCalls = action.mock.calls.length;
    repeat.activate();
    expect(action).toHaveBeenCalledTimes(repeatedCalls);

    repeat.start();
    repeat.stop();
    repeat.activate();
    expect(action).toHaveBeenCalledTimes(repeatedCalls + 1);
    repeat.dispose();
  });
});
