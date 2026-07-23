import {
  type InstalledModuleRegistryPersistence,
  type InstalledModuleRegistrySnapshot,
  type ModuleVersionInstallation,
  PersistentInstalledModuleRegistry,
} from '@localmed/storage';
import { describe, expect, it } from 'vitest';

import { commitRegistryAndArtifactMutation } from './module-registry-transaction';

const MODULE_ID = 'minimed.clinical.pediatrics.infectious';
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function installation(version: string): ModuleVersionInstallation {
  return {
    moduleId: MODULE_ID,
    version,
    required: false,
    installedAt: `2026-07-22T00:00:0${version}.000Z`,
    installedSizeBytes: Number(version) * 1_000,
    sourceSetDigest: digest(version),
    validation: {
      checkedAt: '2026-07-22T00:00:00Z',
      valid: true,
      checksumValid: true,
      schemaCompatible: true,
      sqliteIntegrity: 'ok',
      message: 'validated',
    },
  };
}

class MemoryPersistence implements InstalledModuleRegistryPersistence {
  public value: InstalledModuleRegistrySnapshot | null = null;

  public load(): unknown | null {
    return this.value;
  }

  public save(snapshot: InstalledModuleRegistrySnapshot): void {
    this.value = structuredClone(snapshot);
  }
}

function registryWithTwoVersions() {
  const persistence = new MemoryPersistence();
  const registry = new PersistentInstalledModuleRegistry(persistence);
  registry.activate(installation('1'));
  registry.activate(installation('2'));
  return { persistence, registry };
}

describe('commitRegistryAndArtifactMutation', () => {
  it('commits a registry rollback after the artifact pointer changes', async () => {
    const { registry } = registryWithTwoVersions();

    const result = await commitRegistryAndArtifactMutation(
      registry,
      () => registry.rollback(MODULE_ID),
      async (installed) => {
        expect(installed.version).toBe('1');
      },
    );

    expect(result.version).toBe('1');
    expect(registry.get(MODULE_ID)?.version).toBe('1');
  });

  it('restores rollback metadata when the artifact pointer update fails', async () => {
    const { persistence, registry } = registryWithTwoVersions();

    await expect(
      commitRegistryAndArtifactMutation(
        registry,
        () => registry.rollback(MODULE_ID),
        async () => {
          throw new Error('indexeddb pointer failure');
        },
      ),
    ).rejects.toThrow('indexeddb pointer failure');

    expect(registry.get(MODULE_ID)?.version).toBe('2');
    expect(new PersistentInstalledModuleRegistry(persistence).get(MODULE_ID)?.version).toBe('2');
  });

  it('restores removed metadata when physical deletion fails', async () => {
    const { persistence, registry } = registryWithTwoVersions();

    await expect(
      commitRegistryAndArtifactMutation(
        registry,
        () => registry.remove(MODULE_ID),
        async () => {
          throw new Error('indexeddb delete failure');
        },
      ),
    ).rejects.toThrow('indexeddb delete failure');

    expect(registry.get(MODULE_ID)?.version).toBe('2');
    expect(new PersistentInstalledModuleRegistry(persistence).get(MODULE_ID)?.version).toBe('2');
  });

  it('commits registry removal only after physical deletion succeeds', async () => {
    const { persistence, registry } = registryWithTwoVersions();

    await commitRegistryAndArtifactMutation(
      registry,
      () => registry.remove(MODULE_ID),
      async () => undefined,
    );

    expect(registry.get(MODULE_ID)).toBeNull();
    expect(new PersistentInstalledModuleRegistry(persistence).get(MODULE_ID)).toBeNull();
  });
});
