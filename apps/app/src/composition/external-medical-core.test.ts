import type { MedicalCore } from '@localmed/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createRegisteredExternalMedicalCore,
  hasExternalMedicalCoreFactory,
  registerExternalMedicalCoreFactory,
} from '@/composition/external-medical-core';

describe('external MedicalCore registration', () => {
  it('registers one optional core factory and removes it with the returned cleanup', async () => {
    const core = {} as MedicalCore;
    const factory = vi.fn(async () => core);
    const unregister = registerExternalMedicalCoreFactory(factory);

    expect(hasExternalMedicalCoreFactory()).toBe(true);
    await expect(createRegisteredExternalMedicalCore()).resolves.toBe(core);
    expect(factory).toHaveBeenCalledOnce();

    unregister();
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
