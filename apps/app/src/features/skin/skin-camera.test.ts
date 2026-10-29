import { describe, expect, it, vi } from 'vitest';

import {
  activeZoomChip,
  cameraApiAvailable,
  classifyCameraError,
  probeCameraPresence,
  skinCameraControls,
  startSkinCamera,
  zoomChipLabel,
  zoomChipValues,
} from '@/features/skin/skin-camera';

describe('camera controls from the track capabilities', () => {
  it('offers only what the device reports', () => {
    expect(skinCameraControls({})).toEqual({ torch: false });
    expect(
      skinCameraControls({
        zoom: { min: 0.5, max: 8, step: 0.1 },
        torch: true,
        focusMode: ['continuous', 'manual'],
        focusDistance: { min: 0.1, max: 1, step: 0.01 },
      }),
    ).toEqual({
      zoom: { min: 0.5, max: 8, step: 0.1 },
      torch: true,
      focusDistance: { min: 0.1, max: 1, step: 0.01 },
    });
  });

  it('ignores a focus distance without manual focus and a degenerate zoom range', () => {
    const controls = skinCameraControls({
      zoom: { min: 1, max: 1 },
      focusDistance: { min: 0.1, max: 1 },
      focusMode: ['continuous'],
    });
    expect(controls.zoom).toBeUndefined();
    expect(controls.focusDistance).toBeUndefined();
  });
});

describe('zoom chips', () => {
  it('takes the presets that fall inside the real range', () => {
    expect(zoomChipValues({ min: 0.5, max: 8, step: 0 })).toEqual([0.5, 1, 2, 3, 5]);
    expect(zoomChipValues({ min: 1, max: 4, step: 0.1 })).toEqual([1, 2, 3]);
  });

  it('falls back to the two ends for a narrow range and to nothing for a fixed lens', () => {
    expect(zoomChipValues({ min: 1, max: 1.4, step: 0 })).toEqual([1, 1.4]);
    expect(zoomChipValues(undefined)).toEqual([]);
  });

  it('snaps chips to the step grid', () => {
    expect(zoomChipValues({ min: 1, max: 5, step: 0.5 })).toEqual([1, 2, 3, 5]);
  });

  it('labels and picks the active chip', () => {
    expect(zoomChipLabel(0.5)).toBe('0.5×');
    expect(zoomChipLabel(2)).toBe('2×');
    expect(activeZoomChip([0.5, 1, 2], 1.1)).toBe(1);
    expect(activeZoomChip([0.5, 1, 2], undefined)).toBeUndefined();
  });
});

describe('failures', () => {
  it('classifies the errors a browser throws', () => {
    expect(classifyCameraError(new DOMException('x', 'NotAllowedError'))).toBe('denied');
    expect(classifyCameraError(new DOMException('x', 'NotFoundError'))).toBe('absent');
    expect(classifyCameraError(new DOMException('x', 'NotReadableError'))).toBe('busy');
    expect(classifyCameraError(new Error('boom'))).toBe('unknown');
  });

  it('reports a missing API, an empty device list and an unreadable one', async () => {
    expect(cameraApiAvailable(undefined)).toBe(false);
    expect(cameraApiAvailable({ getUserMedia: vi.fn() })).toBe(true);
    expect(await probeCameraPresence(undefined)).toBe('unknown');
    expect(
      await probeCameraPresence({
        enumerateDevices: async () => [{ kind: 'audioinput' } as never],
      }),
    ).toBe('absent');
    expect(
      await probeCameraPresence({
        enumerateDevices: async () => [{ kind: 'videoinput' } as never],
      }),
    ).toBe('present');
    expect(
      await probeCameraPresence({
        enumerateDevices: async () => {
          throw new Error('x');
        },
      }),
    ).toBe('unknown');
  });

  it('does not ask for a camera the device list says is not there', async () => {
    const getUserMedia = vi.fn();
    const result = await startSkinCamera({ getUserMedia, enumerateDevices: async () => [] });
    expect(result).toEqual({ kind: 'failed', reason: 'absent' });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('turns a refused permission into a value, never a throw', async () => {
    expect(await startSkinCamera(undefined)).toEqual({ kind: 'failed', reason: 'unsupported' });
    const denied = await startSkinCamera({
      getUserMedia: async () => {
        throw new DOMException('no', 'NotAllowedError');
      },
    });
    expect(denied).toEqual({ kind: 'failed', reason: 'denied' });
  });
});

describe('a live session', () => {
  function fakeTrack() {
    const applied: unknown[] = [];
    const track = {
      getCapabilities: () => ({ zoom: { min: 1, max: 4, step: 0.1 }, torch: true }),
      getSettings: () => ({ zoom: 2 }),
      applyConstraints: async (constraints: unknown) => {
        applied.push(constraints);
      },
      stop: vi.fn(),
    };
    return { track, applied };
  }

  it('applies zoom and torch as advanced constraints and stops its tracks', async () => {
    const { track, applied } = fakeTrack();
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
    const result = await startSkinCamera({ getUserMedia: async () => stream as never });
    if (result.kind !== 'live') throw new Error('expected a live camera');
    expect(result.session.controls.torch).toBe(true);
    expect(result.session.currentZoom()).toBe(2);
    await result.session.setZoom(3);
    await result.session.setTorch(true);
    expect(applied).toEqual([{ advanced: [{ zoom: 3 }] }, { advanced: [{ torch: true }] }]);
    result.session.stop();
    expect(track.stop).toHaveBeenCalled();
  });
});
