import { describe, expect, it, vi } from 'vitest';

import {
  apkDownloadCacheKey,
  assertHttpsApkUrl,
  decodeCapacitorHttpBody,
  encodeBytesToBase64,
  splitBytesForBridge,
  writeApkBytesToNative,
} from '@/state/native-update';

describe('Android APK fetch install helpers', () => {
  it('rejects non-HTTPS URLs', () => {
    expect(() => assertHttpsApkUrl('http://example.test/app.apk')).toThrow(
      'Only HTTPS APK URLs are allowed.',
    );
  });

  it('keys the resumable cache to the APK URL', () => {
    expect(apkDownloadCacheKey('https://example.test/app.apk')).toBe(
      'apk:https://example.test/app.apk',
    );
  });

  it('encodes a binary chunk as base64', () => {
    expect(encodeBytesToBase64(Uint8Array.from([77, 105, 110, 105]))).toBe(btoa('Mini'));
  });

  it('decodes CapacitorHttp binary bodies from base64, latin-1 APK bytes, and ArrayBuffers', () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    expect(decodeCapacitorHttpBody(btoa('Mini'))).toEqual(Uint8Array.from([77, 105, 110, 105]));
    expect(
      decodeCapacitorHttpBody(
        `data:application/vnd.android.package-archive;base64,${btoa('Mini')}`,
      ),
    ).toEqual(Uint8Array.from([77, 105, 110, 105]));
    expect(decodeCapacitorHttpBody('PK\u0003\u0004ab')).toEqual(
      Uint8Array.from([80, 75, 3, 4, 97, 98]),
    );
    expect(decodeCapacitorHttpBody(bytes.buffer)).toEqual(bytes);
    expect(decodeCapacitorHttpBody(bytes)).toEqual(bytes);
    expect(() => decodeCapacitorHttpBody({ unexpected: true })).toThrow(
      'CapacitorHttp returned an unsupported APK body type.',
    );
  });

  it('writes fetched bytes to the native installer in chunks', async () => {
    const plugin = {
      prepareApkFile: vi.fn(async () => ({ path: '/tmp/minimed-update.apk' })),
      appendApkChunk: vi.fn(async () => ({ bytes: 4 })),
      installPreparedApk: vi.fn(async () => ({ path: '/tmp/minimed-update.apk' })),
    };
    const bytes = Uint8Array.from([1, 2, 3, 4]);

    await writeApkBytesToNative(bytes, plugin, 2);

    expect(plugin.prepareApkFile).toHaveBeenCalledTimes(1);
    expect(plugin.appendApkChunk).toHaveBeenCalledTimes(2);
    expect(plugin.appendApkChunk).toHaveBeenNthCalledWith(1, {
      chunk: encodeBytesToBase64(Uint8Array.from([1, 2])),
    });
    expect(plugin.appendApkChunk).toHaveBeenNthCalledWith(2, {
      chunk: encodeBytesToBase64(Uint8Array.from([3, 4])),
    });
    expect(plugin.installPreparedApk).toHaveBeenCalledTimes(1);
    expect(splitBytesForBridge(bytes, 2)).toHaveLength(2);
  });
});
