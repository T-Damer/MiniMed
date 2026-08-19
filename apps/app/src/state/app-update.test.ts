import { describe, expect, it, vi } from 'vitest';

import {
  activateAppUpdate,
  appUpdateVersionFromWorker,
  checkWebAppUpdate,
  formatAppUpdateCheckerStatus,
  formatAppUpdateLabel,
  selectLatestApkUpdate,
} from '@/state/app-update';

describe('app update label', () => {
  it('shows percent while downloading', () => {
    expect(formatAppUpdateLabel(true, { phase: 'download', loaded: 512, total: 1024 })).toBe(
      'Загрузка 50%',
    );
  });

  it('keeps a loading label when the size is unknown', () => {
    expect(formatAppUpdateLabel(true, { phase: 'download' })).toBe('Загрузка…');
  });

  it('shows activation copy for service worker updates', () => {
    expect(formatAppUpdateLabel(true, { phase: 'activate' })).toBe('Активация…');
  });
});

describe('app update checker copy', () => {
  it('names the installed version until a newer build is ready', () => {
    expect(
      formatAppUpdateCheckerStatus({
        version: '0.6.25',
        ready: false,
        checking: false,
        updating: false,
      }),
    ).toEqual({
      body: 'Установлена версия 0.6.25.',
      checkLabel: 'Проверить обновления',
    });
  });

  it('tells the doctor a newer build is waiting', () => {
    expect(
      formatAppUpdateCheckerStatus({
        version: '0.6.25',
        ready: true,
        checking: false,
        updating: false,
      }).body,
    ).toBe('Доступна новая версия приложения.');
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

describe('web service worker update check', () => {
  it('announces a waiting worker after registration.update()', async () => {
    const waiting = {} as ServiceWorker;
    const update = vi.fn(async () => undefined);
    const dispatchReady = vi.fn();

    const ready = await checkWebAppUpdate(
      async () => ({ waiting, update }) as unknown as ServiceWorkerRegistration,
      dispatchReady,
    );

    expect(update).toHaveBeenCalledTimes(1);
    expect(ready).toBe(true);
    expect(dispatchReady).toHaveBeenCalledWith(waiting);
  });
});

describe('web service worker update identity', () => {
  it('reads the waiting worker version from its script URL', () => {
    expect(
      appUpdateVersionFromWorker({ scriptURL: 'https://example.test/app/sw.js?v=0.6.29' }),
    ).toBe('0.6.29');
    expect(appUpdateVersionFromWorker({})).toBe('pending');
    expect(appUpdateVersionFromWorker(undefined)).toBeUndefined();
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
    ).toEqual({ version: '9.0.2', url: 'https://example.test/new.apk' });
  });
});
