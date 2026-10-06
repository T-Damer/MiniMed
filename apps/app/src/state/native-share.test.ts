import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: vi.fn(() => 'android'),
  shareFile: vi.fn(async () => undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: mocks.platform },
  registerPlugin: () => ({ shareFile: mocks.shareFile, shareText: vi.fn() }),
}));

import { saveBlobAsFile, savesThroughShareSheet, shareSystemFile } from '@/state/native-share';

describe('shareSystemFile', () => {
  beforeEach(() => {
    mocks.platform.mockReturnValue('android');
    mocks.shareFile.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the actual file bytes to the Android system share bridge', async () => {
    await expect(
      shareSystemFile({
        title: 'Справка',
        fileName: 'справка.txt',
        mimeType: 'text/plain',
        blob: new Blob(['hello'], { type: 'text/plain' }),
      }),
    ).resolves.toBe('shared');

    expect(mocks.shareFile).toHaveBeenCalledWith({
      title: 'Справка',
      fileName: 'справка.txt',
      mimeType: 'text/plain',
      data: 'aGVsbG8=',
    });
  });

  it('downloads the file when macOS denies the browser share request', async () => {
    mocks.platform.mockReturnValue('web');
    const click = vi.fn();
    const remove = vi.fn();
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal('navigator', {
      canShare: vi.fn(() => true),
      share: vi.fn(async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      }),
    });
    vi.stubGlobal('setTimeout', (callback: () => void) => {
      callback();
      return 0;
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:minimed-share'),
      revokeObjectURL: revokeObjectUrl,
    });
    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement: vi.fn(() => ({ click, download: '', href: '', remove })),
    });

    await expect(
      shareSystemFile({
        title: 'Справка',
        fileName: 'справка.txt',
        mimeType: 'text/plain',
        blob: new Blob(['hello'], { type: 'text/plain' }),
      }),
    ).resolves.toBe('downloaded');

    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:minimed-share');
  });
});

describe('saveBlobAsFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.platform.mockReturnValue('android');
  });

  it('uses the share sheet only inside the iOS app', () => {
    expect(savesThroughShareSheet('ios')).toBe(true);
    expect(savesThroughShareSheet('android')).toBe(false);
    expect(savesThroughShareSheet('web')).toBe(false);
  });

  it('hands the file to the iOS share sheet instead of a silent anchor download', async () => {
    mocks.platform.mockReturnValue('ios');
    const share = vi.fn(async () => undefined);
    const createElement = vi.fn();
    vi.stubGlobal('navigator', { canShare: vi.fn(() => true), share });
    vi.stubGlobal('document', { createElement });

    await saveBlobAsFile(new Blob(['{}'], { type: 'application/json' }), 'копия.json');

    expect(share).toHaveBeenCalledOnce();
    const payload = (share.mock.calls[0] as unknown as [{ files: File[] }])[0];
    expect(payload.files[0]?.name).toBe('копия.json');
    expect(createElement).not.toHaveBeenCalled();
  });

  it('downloads through an anchor on the web', async () => {
    mocks.platform.mockReturnValue('web');
    const click = vi.fn();
    vi.stubGlobal('setTimeout', (callback: () => void) => {
      callback();
      return 0;
    });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement: vi.fn(() => ({ click, download: '', href: '', remove: vi.fn() })),
    });

    await saveBlobAsFile(new Blob(['a']), 'a.txt');

    expect(click).toHaveBeenCalledOnce();
  });
});
