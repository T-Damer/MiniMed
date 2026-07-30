import type { CoreCapabilities, MedicalCore } from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createRegisteredExternalMedicalCore,
  hasExternalMedicalCoreFactory,
  registerExternalMedicalCoreFactory,
} from '@/composition/external-medical-core';

const CAPABILITIES: CoreCapabilities = {
  lexicalSearch: true,
  queryAnalysis: true,
  semanticSearch: false,
  embeddingProfileIds: [],
  cloudChat: false,
  localCaseExtraction: false,
  platform: 'test',
  sqliteVersion: 'external',
  fts5Available: false,
  storageBackend: 'multi-store',
  persistentStorage: true,
  storageInstallation: 'reused',
  storageSizeBytes: null,
};

describe('external MedicalCore registration', () => {
  it('registers one optional core and marks its search execution as direct-only', async () => {
    const getCapabilities = vi.fn(async () => ({ ok: true as const, value: CAPABILITIES }));
    const core = { getCapabilities } as unknown as MedicalCore;
    const factory = vi.fn(async () => core);
    const unregister = registerExternalMedicalCoreFactory(factory);

    try {
      expect(hasExternalMedicalCoreFactory()).toBe(true);
      const registered = await createRegisteredExternalMedicalCore();
      expect(registered).not.toBeNull();
      if (!registered) return;

      await expect(registered.getCapabilities()).resolves.toEqual({
        ok: true,
        value: {
          ...CAPABILITIES,
          searchExecution: 'direct-only',
        },
      });
      expect(factory).toHaveBeenCalledOnce();
      expect(getCapabilities).toHaveBeenCalledOnce();
    } finally {
      unregister();
    }

    expect(hasExternalMedicalCoreFactory()).toBe(false);
    await expect(createRegisteredExternalMedicalCore()).resolves.toBeNull();
  });

  it('rejects an ambiguous second provider instead of silently changing the active backend', () => {
    const unregister = registerExternalMedicalCoreFactory(async () => null);
    try {
      expect(() => registerExternalMedicalCoreFactory(async () => null)).toThrow(
        'An external MedicalCore factory is already registered.',
      );
    } finally {
      unregister();
    }
  });
});
