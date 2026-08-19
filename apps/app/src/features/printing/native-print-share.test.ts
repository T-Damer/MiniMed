import { describe, expect, it, vi } from 'vitest';

import {
  clipNativePrintShareText,
  shareNativePrintContent,
} from '@/features/printing/native-print-share';

describe('clipNativePrintShareText', () => {
  it('returns short text unchanged', () => {
    expect(clipNativePrintShareText('hello')).toBe('hello');
  });

  it('clips long text with an ellipsis', () => {
    expect(clipNativePrintShareText('abcdefghij', 6)).toBe('abcde…');
  });
});

describe('shareNativePrintContent', () => {
  it('uses the Android share sheet and never prints', async () => {
    const androidShare = vi.fn(async () => undefined);
    const print = vi.fn();
    await expect(
      shareNativePrintContent({
        title: 'Title',
        text: 'Body',
        platform: 'android',
        androidShare,
        webShare: vi.fn(),
        print,
      }),
    ).resolves.toBe('shared');
    expect(androidShare).toHaveBeenCalledWith({ title: 'Title', text: 'Body' });
    expect(print).not.toHaveBeenCalled();
  });

  it('falls back to web share when the Android sheet is unavailable', async () => {
    const webShare = vi.fn(async () => undefined);
    await expect(
      shareNativePrintContent({
        title: 'Title',
        text: 'Body',
        platform: 'android',
        androidShare: async () => {
          throw new Error('missing plugin');
        },
        webShare,
        print: vi.fn(),
      }),
    ).resolves.toBe('shared');
    expect(webShare).toHaveBeenCalledWith({ title: 'Title', text: 'Body' });
  });

  it('does not print on Android when every share path fails', async () => {
    const print = vi.fn();
    await expect(
      shareNativePrintContent({
        title: 'Title',
        text: 'Body',
        platform: 'android',
        androidShare: async () => {
          throw new Error('missing plugin');
        },
        print,
      }),
    ).resolves.toBe('cancelled');
    expect(print).not.toHaveBeenCalled();
  });

  it('uses web share on iOS and treats AbortError as cancel', async () => {
    const print = vi.fn();
    await expect(
      shareNativePrintContent({
        title: 'Title',
        text: 'Body',
        platform: 'ios',
        androidShare: vi.fn(),
        webShare: async () => {
          throw new DOMException('dismissed', 'AbortError');
        },
        print,
      }),
    ).resolves.toBe('cancelled');
    expect(print).not.toHaveBeenCalled();
  });

  it('prints when web share is missing on non-Android platforms', async () => {
    const print = vi.fn();
    await expect(
      shareNativePrintContent({
        title: 'Title',
        text: 'Body',
        platform: 'web',
        androidShare: vi.fn(),
        print,
      }),
    ).resolves.toBe('printed');
    expect(print).toHaveBeenCalledOnce();
  });
});
