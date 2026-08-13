import { describe, expect, it } from 'vitest';

import { LlamaNativeRuntime } from '@/features/models/llama-runtime';
import type { LocalModelDeviceProfile } from '@/features/models/types';

function profile(overrides: Partial<LocalModelDeviceProfile> = {}): LocalModelDeviceProfile {
  return {
    platform: 'browser',
    nativeContainer: false,
    deviceMemoryGb: 4,
    hardwareConcurrency: 4,
    freeStorageBytes: 1_000_000_000,
    webgpu: false,
    saveData: false,
    effectiveConnectionType: '4g',
    automation: false,
    cpuProbeScore: 1000,
    fingerprint: 'test',
    ...overrides,
  };
}

describe('LlamaNativeRuntime.isAvailable', () => {
  const runtime = new LlamaNativeRuntime({ mirrorBaseUrl: '' });

  it('is unavailable in a plain browser', async () => {
    expect(await runtime.isAvailable(profile())).toBe(false);
  });

  it('is unavailable on Android without a native container (e.g. WebView-only)', async () => {
    expect(
      await runtime.isAvailable(profile({ platform: 'android', nativeContainer: false })),
    ).toBe(false);
  });

  it('is unavailable on native iOS (Android-only for this pass)', async () => {
    expect(await runtime.isAvailable(profile({ platform: 'ios', nativeContainer: true }))).toBe(
      false,
    );
  });

  it('is available on a native Android app', async () => {
    expect(await runtime.isAvailable(profile({ platform: 'android', nativeContainer: true }))).toBe(
      true,
    );
  });
});
