import { describe, expect, it, vi } from 'vitest';

import { activateAppUpdate, formatAppUpdateLabel, selectLatestApkUpdate } from '@/state/app-update';

describe('app update label', () => {
  it('shows percent while downloading', () => {
    expect(formatAppUpdateLabel(true, { phase: 'download', loaded: 512, total: 1024 })).toBe('50%');
  });

  it('shows activation copy for service worker updates', () => {
    expect(formatAppUpdateLabel(true, { phase: 'activate' })).toBe('Активация…');
  });
});

describe('app update activation', () => {
  it('waits for the user action before asking the worker to activate', () => {
    const postMessage = vi.fn();
    const addEventListener = vi.fn();
    const reload = vi.fn();

    activateAppUpdate({ postMessage }, { addEventListener }, reload);

    expect(addEventListener).toHaveBeenCalledWith('controllerchange', reload, { once: true });
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });
});

describe('Android APK update selection', () => {
  it('selects the newest APK from prereleases', () => {
    expect(
      selectLatestApkUpdate([
        {
          tag_name: 'v9.0.0',
          draft: false,
          assets: [{ browser_download_url: 'https://example.test/old.apk' }],
        },
        {
          tag_name: 'v9.0.2',
          draft: false,
          assets: [{ browser_download_url: 'https://example.test/new.apk' }],
        },
        {
          tag_name: 'v9.0.3',
          draft: true,
          assets: [{ browser_download_url: 'https://example.test/draft.apk' }],
        },
      ]),
    ).toBe('https://example.test/new.apk');
  });
});
