import { describe, expect, it, vi } from 'vitest';
import {
  captureNativePhoto,
  type NativeCameraDeps,
  NativeCameraError,
  nativeCameraMessage,
  photoCapturePath,
  routeRestoredCameraPhoto,
} from './native-camera';

function deps(overrides: Partial<NativeCameraDeps['plugin']> = {}): {
  readonly deps: NativeCameraDeps;
  readonly discard: ReturnType<typeof vi.fn>;
  readonly fetchFile: ReturnType<typeof vi.fn>;
} {
  const discard = vi.fn(async () => undefined);
  const fetchFile = vi.fn(async () => new Blob(['jpeg-bytes'], { type: 'image/jpeg' }));
  return {
    discard,
    fetchFile,
    deps: {
      plugin: {
        capturePhoto: vi.fn(async ({ id, purpose }) => ({
          id,
          path: `/cache/localmed/camera/${id}.jpg`,
          mimeType: 'image/jpeg',
          purpose,
        })),
        discardPhoto: discard,
        ...overrides,
      },
      convertFileSrc: (path) => `https://localhost/_capacitor_file_${path}`,
      fetchFile,
      newId: () => 'capture-0001',
    },
  };
}

describe('photoCapturePath', () => {
  it('uses the native camera on Android and the web paths elsewhere', () => {
    expect(photoCapturePath('android')).toBe('native');
    expect(photoCapturePath('web')).toBe('web');
    expect(photoCapturePath('ios')).toBe('web');
  });
});

describe('captureNativePhoto', () => {
  it('reads the photo through the bridge and only then lets the plugin delete the file', async () => {
    const { deps: fake, discard, fetchFile } = deps();

    const file = await captureNativePhoto('ecg', fake);

    expect(fetchFile).toHaveBeenCalledWith(
      'https://localhost/_capacitor_file_/cache/localmed/camera/capture-0001.jpg',
    );
    expect(file).toBeInstanceOf(File);
    expect(file?.type).toBe('image/jpeg');
    expect(await file?.text()).toBe('jpeg-bytes');
    expect(discard).toHaveBeenCalledWith({ id: 'capture-0001' });
    expect(fetchFile.mock.invocationCallOrder[0]).toBeLessThan(
      discard.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('keeps the file when it could not be read', async () => {
    const { deps: fake, discard, fetchFile } = deps();
    fetchFile.mockRejectedValueOnce(new Error('offline'));

    await expect(captureNativePhoto('skin', fake)).rejects.toThrow('offline');
    expect(discard).not.toHaveBeenCalled();
  });

  it('treats a closed camera as nothing taken, not as a failure', async () => {
    const cancelled = Object.assign(new Error('x'), { code: 'CAMERA_CANCELLED' });
    const { deps: fake } = deps({ capturePhoto: vi.fn().mockRejectedValue(cancelled) });

    await expect(captureNativePhoto('ecg', fake)).resolves.toBeUndefined();
  });

  it('names a refused permission, a missing camera app and anything else', async () => {
    for (const [code, failure] of [
      ['CAMERA_DENIED', 'denied'],
      ['CAMERA_UNAVAILABLE', 'unavailable'],
      ['UNIMPLEMENTED', 'failed'],
    ] as const) {
      const { deps: fake } = deps({
        capturePhoto: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code })),
      });
      await expect(captureNativePhoto('skin', fake)).rejects.toMatchObject({
        name: 'NativeCameraError',
        failure,
      });
    }
    expect(nativeCameraMessage('denied')).toMatch(/настройках/u);
    expect(new NativeCameraError('failed').failure).toBe('failed');
  });
});

describe('routeRestoredCameraPhoto', () => {
  const restored = (purpose: unknown, overrides: Record<string, unknown> = {}) => ({
    pluginId: 'LocalMedCamera',
    methodName: 'capturePhoto',
    success: true,
    data: {
      id: 'capture-0002',
      path: '/cache/localmed/camera/capture-0002.jpg',
      mimeType: 'image/jpeg',
      purpose,
    },
    ...overrides,
  });

  it('hands a photo taken before the app was killed to the ECG tool', async () => {
    const { deps: fake, discard } = deps();
    const handlers = { ecg: vi.fn(), skin: vi.fn() };

    await expect(routeRestoredCameraPhoto(restored('ecg'), handlers, fake)).resolves.toBe(true);

    expect(handlers.ecg).toHaveBeenCalledOnce();
    expect(handlers.skin).not.toHaveBeenCalled();
    const file = handlers.ecg.mock.calls[0]?.[0] as File;
    expect(await file.text()).toBe('jpeg-bytes');
    // The temp file stays until the page holds the photo, then goes.
    expect(discard).toHaveBeenCalledWith({ id: 'capture-0002' });
  });

  it('hands it to the skin tool when that asked for it', async () => {
    const { deps: fake } = deps();
    const handlers = { ecg: vi.fn(), skin: vi.fn() };

    await expect(routeRestoredCameraPhoto(restored('skin'), handlers, fake)).resolves.toBe(true);

    expect(handlers.skin).toHaveBeenCalledOnce();
    expect(handlers.ecg).not.toHaveBeenCalled();
  });

  it('ignores other plugins, failed calls and unreadable data', async () => {
    const { deps: fake, discard } = deps();
    const handlers = { ecg: vi.fn(), skin: vi.fn() };

    expect(
      await routeRestoredCameraPhoto(restored('ecg', { pluginId: 'Camera' }), handlers, fake),
    ).toBe(false);
    expect(
      await routeRestoredCameraPhoto(
        restored('ecg', { methodName: 'discardPhoto' }),
        handlers,
        fake,
      ),
    ).toBe(false);
    expect(
      await routeRestoredCameraPhoto(restored('ecg', { success: false }), handlers, fake),
    ).toBe(false);
    expect(await routeRestoredCameraPhoto(restored('ecg', { data: {} }), handlers, fake)).toBe(
      false,
    );
    expect(handlers.ecg).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
  });

  it('drops a photo that names no tool instead of keeping it', async () => {
    const { deps: fake, discard } = deps();
    const handlers = { ecg: vi.fn(), skin: vi.fn() };

    expect(await routeRestoredCameraPhoto(restored(null), handlers, fake)).toBe(false);
    expect(handlers.ecg).not.toHaveBeenCalled();
    expect(handlers.skin).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith({ id: 'capture-0002' });
  });
});
