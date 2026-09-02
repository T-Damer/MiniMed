import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: vi.fn(() => 'android'),
  setStatusBar: vi.fn(async () => undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: mocks.platform },
  registerPlugin: () => ({ setStatusBar: mocks.setStatusBar }),
}));

import { setDarkHeaderStatusBar } from '@/state/native-system-ui';

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
