import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  available: vi.fn(() => true),
  native: vi.fn(() => true),
  update: vi.fn(),
  status: undefined as ((value: { presented: boolean }) => void) | undefined,
  openUrl: undefined as ((value: { url: string }) => void) | undefined,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: bridge.native, isPluginAvailable: bridge.available },
  registerPlugin: () => ({
    update: bridge.update,
    addListener: (_event: string, listener: typeof bridge.status) => {
      bridge.status = listener;
      return Promise.resolve();
    },
  }),
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (_event: string, listener: typeof bridge.openUrl) => {
      bridge.openUrl = listener;
      return Promise.resolve();
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  bridge.available.mockReturnValue(true);
  bridge.native.mockReturnValue(true);
  bridge.update.mockReset();
  bridge.status = undefined;
  bridge.openUrl = undefined;
});

describe('system recording indicator', () => {
  it('keeps the app indicator when the device has no usable native surface', async () => {
    bridge.native.mockReturnValue(false);
    const { nativeRecordingPresented, updateNativeRecordingActivity } = await import(
      '@/features/conversations/native-recording-activity'
    );
    const controls = { open: vi.fn(), onPresented: vi.fn() };
    updateNativeRecordingActivity('recording', 0, controls);
    expect(nativeRecordingPresented()).toBe(false);
    expect(bridge.update).not.toHaveBeenCalled();
    expect(controls.onPresented).not.toHaveBeenCalled();
  });

  it('hands off only after confirmation, reopens on a system tap and restores the fallback on dismissal', async () => {
    bridge.update.mockResolvedValue({ presented: true });
    const { nativeRecordingPresented, updateNativeRecordingActivity } = await import(
      '@/features/conversations/native-recording-activity'
    );
    const controls = { open: vi.fn(), onPresented: vi.fn() };
    updateNativeRecordingActivity('recording', 0, controls);
    expect(nativeRecordingPresented()).toBe(false);
    await vi.waitFor(() => expect(nativeRecordingPresented()).toBe(true));
    expect(controls.onPresented).toHaveBeenCalledOnce();

    bridge.openUrl?.({ url: 'minimed-recording://open' });
    expect(controls.open).toHaveBeenCalledOnce();
    bridge.status?.({ presented: false });
    expect(nativeRecordingPresented()).toBe(false);

    bridge.update.mockResolvedValue({ presented: false });
    updateNativeRecordingActivity('ended', 1050);
    await vi.waitFor(() =>
      expect(bridge.update).toHaveBeenLastCalledWith({ state: 'ended', elapsedMs: 1050 }),
    );
    bridge.openUrl?.({ url: 'minimed-recording://open' });
    expect(controls.open).toHaveBeenCalledOnce();
  });
});
