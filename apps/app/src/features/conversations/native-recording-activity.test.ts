import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = vi.hoisted(() => ({
  available: vi.fn(() => true),
  native: vi.fn(() => true),
  platform: vi.fn(() => 'ios'),
  activityEnabled: vi.fn(() => true),
  notificationSettings: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  update: vi.fn(),
  launchUrl: vi.fn(),
  status: undefined as ((value: { presented: boolean }) => void) | undefined,
  openRecording: undefined as (() => void) | undefined,
  openUrl: undefined as ((value: { url: string }) => void) | undefined,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: bridge.native,
    isPluginAvailable: bridge.available,
    getPlatform: bridge.platform,
  },
  registerPlugin: () => ({
    update: bridge.update,
    notificationSettings: bridge.notificationSettings,
    addListener: (event: string, listener: (value?: { presented: boolean }) => void) => {
      if (event === 'openRecording') bridge.openRecording = listener;
      if (event === 'presentationChanged') bridge.status = listener;
      return Promise.resolve();
    },
  }),
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: bridge.checkPermissions,
    requestPermissions: bridge.requestPermissions,
  },
}));
vi.mock('@/state/app-preferences', () => ({
  loadAppPreferences: () => ({ recordingActivityEnabled: bridge.activityEnabled() }),
}));
vi.mock('@capacitor/app', () => ({
  App: {
    getLaunchUrl: bridge.launchUrl,
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
  bridge.platform.mockReturnValue('ios');
  bridge.activityEnabled.mockReturnValue(true);
  bridge.notificationSettings.mockReset();
  bridge.checkPermissions.mockReset();
  bridge.requestPermissions.mockReset();
  bridge.update.mockReset();
  bridge.launchUrl.mockReset().mockResolvedValue(undefined);
  bridge.status = undefined;
  bridge.openRecording = undefined;
  bridge.openUrl = undefined;
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key),
      setItem: storage.set.bind(storage),
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

it('delivers a cold launch action for the exact recording before a recorder is running', async () => {
  bridge.launchUrl.mockResolvedValue({ url: 'minimed-recording://open?id=conv-interrupted' });
  const { watchNativeRecordingActions } = await import(
    '@/features/conversations/native-recording-activity'
  );
  const action = vi.fn();
  const unwatch = watchNativeRecordingActions(action);
  await vi.waitFor(() => expect(action).toHaveBeenCalledWith('open', 'conv-interrupted'));
  bridge.openUrl?.({ url: 'minimed-recording://stop?id=conv-interrupted' });
  expect(action).toHaveBeenLastCalledWith('stop', 'conv-interrupted');
  unwatch();
});

describe('system recording indicator', () => {
  it('keeps the app indicator when the device has no usable native surface', async () => {
    bridge.native.mockReturnValue(false);
    const { nativeRecordingPresented, updateNativeRecordingActivity } = await import(
      '@/features/conversations/native-recording-activity'
    );
    const controls = { open: vi.fn(), onPresented: vi.fn() };
    updateNativeRecordingActivity('recording', () => 0, controls);
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
    updateNativeRecordingActivity('recording', () => 0, controls);
    expect(nativeRecordingPresented()).toBe(false);
    await vi.waitFor(() => expect(nativeRecordingPresented()).toBe(true));
    expect(controls.onPresented).toHaveBeenCalledOnce();
    expect(bridge.requestPermissions).not.toHaveBeenCalled();

    bridge.openUrl?.({ url: 'minimed-recording://open' });
    expect(controls.open).toHaveBeenCalledOnce();
    bridge.status?.({ presented: false });
    expect(nativeRecordingPresented()).toBe(false);

    bridge.update.mockResolvedValue({ presented: false });
    updateNativeRecordingActivity('ended', () => 1050);
    await vi.waitFor(() =>
      expect(bridge.update).toHaveBeenLastCalledWith({ state: 'ended', elapsedMs: 1050 }),
    );
    bridge.openUrl?.({ url: 'minimed-recording://open' });
    expect(controls.open).toHaveBeenCalledOnce();
  });

  it('asks Android for permission once and keeps the in-app indicator after a refusal', async () => {
    bridge.platform.mockReturnValue('android');
    bridge.notificationSettings.mockResolvedValue({
      notificationsEnabled: false,
      recordingSupported: true,
    });
    bridge.checkPermissions.mockResolvedValue({ display: 'prompt' });
    bridge.requestPermissions.mockResolvedValue({ display: 'denied' });
    bridge.update.mockResolvedValue({ presented: false });
    const { nativeRecordingPresented, updateNativeRecordingActivity } = await import(
      '@/features/conversations/native-recording-activity'
    );
    const controls = { open: vi.fn(), onPresented: vi.fn() };
    updateNativeRecordingActivity('recording', () => 0, controls);
    await vi.waitFor(() => expect(bridge.update).toHaveBeenCalledOnce());
    expect(bridge.requestPermissions).toHaveBeenCalledOnce();
    expect(nativeRecordingPresented()).toBe(false);
    expect(controls.onPresented).not.toHaveBeenCalled();

    updateNativeRecordingActivity('ended', () => 1000);
    updateNativeRecordingActivity('recording', () => 0, controls);
    await vi.waitFor(() => expect(bridge.update).toHaveBeenCalledTimes(3));
    expect(bridge.requestPermissions).toHaveBeenCalledOnce();
  });

  it('keeps the in-app indicator and skips the prompt when system presentation is disabled', async () => {
    bridge.platform.mockReturnValue('android');
    bridge.activityEnabled.mockReturnValue(false);
    const { nativeRecordingPresented, updateNativeRecordingActivity } = await import(
      '@/features/conversations/native-recording-activity'
    );
    updateNativeRecordingActivity('recording', () => 0, { open: vi.fn(), onPresented: vi.fn() });
    await Promise.resolve();
    expect(bridge.update).not.toHaveBeenCalled();
    expect(bridge.requestPermissions).not.toHaveBeenCalled();
    expect(nativeRecordingPresented()).toBe(false);
  });

  it('publishes the first Android activity after the permission grant', async () => {
    bridge.platform.mockReturnValue('android');
    bridge.notificationSettings.mockResolvedValue({
      notificationsEnabled: false,
      recordingSupported: true,
    });
    bridge.checkPermissions.mockResolvedValue({ display: 'prompt' });
    let grantPermission: (() => void) | undefined;
    bridge.requestPermissions.mockReturnValue(
      new Promise((resolve) => {
        grantPermission = () => resolve({ display: 'granted' });
      }),
    );
    bridge.update.mockResolvedValue({ presented: true });
    const { nativeRecordingPresented, updateNativeRecordingActivity } = await import(
      '@/features/conversations/native-recording-activity'
    );
    const elapsedMs = vi.fn(() => 0);
    const open = vi.fn();
    updateNativeRecordingActivity('recording', elapsedMs, { open, onPresented: vi.fn() });
    await vi.waitFor(() => expect(bridge.requestPermissions).toHaveBeenCalledOnce());
    expect(bridge.update).not.toHaveBeenCalled();
    expect(nativeRecordingPresented()).toBe(false);
    elapsedMs.mockReturnValue(8500);
    grantPermission?.();
    await vi.waitFor(() => expect(nativeRecordingPresented()).toBe(true));
    expect(bridge.update).toHaveBeenCalledWith({ state: 'recording', elapsedMs: 8500 });
    bridge.openRecording?.();
    expect(open).toHaveBeenCalledOnce();
    updateNativeRecordingActivity('ended', elapsedMs);
    bridge.openRecording?.();
    expect(open).toHaveBeenCalledOnce();
  });
});
