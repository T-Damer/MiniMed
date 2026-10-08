import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: vi.fn(() => 'android'),
  setStatusBar: vi.fn(async () => undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: mocks.platform },
  registerPlugin: () => ({ setStatusBar: mocks.setStatusBar }),
}));

import { setDarkHeaderStatusBar, setNativeThemeOverride } from '@/state/native-system-ui';

describe('setDarkHeaderStatusBar', () => {
  beforeEach(() => {
    mocks.platform.mockReturnValue('android');
    mocks.setStatusBar.mockClear();
  });

  it('keeps light icons until the last dark-header overlay closes', () => {
    setDarkHeaderStatusBar(true);
    setDarkHeaderStatusBar(true);
    setDarkHeaderStatusBar(false);

    expect(mocks.setStatusBar).toHaveBeenLastCalledWith({
      backgroundColor: '#00000000',
      darkIcons: false,
    });

    setDarkHeaderStatusBar(false);

    expect(mocks.setStatusBar).toHaveBeenLastCalledWith({
      backgroundColor: '#00000000',
    });
  });
});

describe('setNativeThemeOverride', () => {
  beforeEach(() => {
    mocks.platform.mockReturnValue('android');
    mocks.setStatusBar.mockClear();
  });

  it('sets the icon colour from the chosen theme and hands it back to the device', () => {
    setNativeThemeOverride('dark');
    expect(mocks.setStatusBar).toHaveBeenLastCalledWith({
      backgroundColor: '#00000000',
      darkIcons: false,
    });

    setNativeThemeOverride('light');
    expect(mocks.setStatusBar).toHaveBeenLastCalledWith({
      backgroundColor: '#00000000',
      darkIcons: true,
    });

    setNativeThemeOverride(undefined);
    expect(mocks.setStatusBar).toHaveBeenLastCalledWith({ backgroundColor: '#00000000' });
  });

  it('keeps light icons over a dark header whatever the theme', () => {
    setNativeThemeOverride('light');
    setDarkHeaderStatusBar(true);
    expect(mocks.setStatusBar).toHaveBeenLastCalledWith({
      backgroundColor: '#00000000',
      darkIcons: false,
    });
    setDarkHeaderStatusBar(false);
    setNativeThemeOverride(undefined);
  });
});
