import { describe, expect, it } from 'vitest';

import {
  INSTALLED_MODULE_REGISTRY_SNAPSHOT_VERSION,
  InMemoryInstalledModuleRegistry,
  type InstalledModuleRegistrySnapshot,
  type ModuleVersionInstallation,
  PersistentInstalledModuleRegistry,
  type StringKeyValueStorage,
  WebStorageInstalledModuleRegistryPersistence,
} from '../src';

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function installation(
  version: string,
  options: Partial<ModuleVersionInstallation> = {},
): ModuleVersionInstallation {
  return {
    moduleId: 'minimed.clinical.pediatrics.infectious',
    version,
    required: false,
    installedAt: `2026-07-21T00:00:0${version}.000Z`,
    installedSizeBytes: 1_000,
    sourceSetDigest: digest(version),
    validation: {
      checkedAt: '2026-07-21T00:00:00Z',
      valid: true,
      checksumValid: true,
      schemaCompatible: true,
      sqliteIntegrity: 'ok',
      message: 'validated',
    },
    ...options,
  };
}

class MemoryStringStorage implements StringKeyValueStorage {
  private readonly values = new Map<string, string>();
  public failWrites = false;
  public writeCount = 0;

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('storage unavailable');
    this.writeCount += 1;
    this.values.set(key, value);
  }

  public seed(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const STORAGE_KEY = 'test.installed-modules';

function persistentRegistry(storage: MemoryStringStorage): PersistentInstalledModuleRegistry {
  return new PersistentInstalledModuleRegistry(
    new WebStorageInstalledModuleRegistryPersistence(storage, STORAGE_KEY),
  );
}

describe('InMemoryInstalledModuleRegistry', () => {
  it('activates an installed module and exposes its validation', () => {
    const registry = new InMemoryInstalledModuleRegistry();

    const active = registry.activate(installation('1'));

    expect(active.state).toBe('installed');
    expect(active.version).toBe('1');
    expect(active.activeSourceSetDigest).toBe(digest('1'));
    expect(active.previousVersions).toEqual([]);
    expect(active.lastValidation?.valid).toBe(true);
  });

  it('keeps a complete previous version and swaps it on rollback', () => {
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate(installation('1', { installedSizeBytes: 1_000 }));
    const updated = registry.activate(installation('2', { installedSizeBytes: 2_000 }));

    expect(updated.version).toBe('2');
    expect(updated.previousVersions).toEqual(['1']);

    const rolledBack = registry.rollback(updated.moduleId);
    expect(rolledBack.version).toBe('1');
    expect(rolledBack.installedSizeBytes).toBe(1_000);
    expect(rolledBack.activeSourceSetDigest).toBe(digest('1'));
    expect(rolledBack.previousVersions).toEqual(['2']);
  });

  it('refreshes one immutable version without creating rollback duplicates', () => {
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate(installation('1'));

    const refreshed = registry.activate(
      installation('1', {
        installedAt: '2026-07-22T00:00:00Z',
        installedSizeBytes: 1_500,
      }),
    );

    expect(refreshed.installedAt).toBe('2026-07-22T00:00:00Z');
    expect(refreshed.installedSizeBytes).toBe(1_500);
    expect(refreshed.previousVersions).toEqual([]);
  });

  it('rejects a changed source set for an immutable module version', () => {
    const registry = new InMemoryInstalledModuleRegistry();
    const active = registry.activate(installation('1'));

    expect(() => registry.activate(installation('1', { sourceSetDigest: digest('a') }))).toThrow(
      'conflicting source-set digest',
    );
    expect(registry.get(active.moduleId)?.activeSourceSetDigest).toBe(digest('1'));
  });

  it('tracks update and enabled state independently', () => {
    const registry = new InMemoryInstalledModuleRegistry();
    const active = registry.activate(installation('1'));

    expect(registry.markUpdateAvailable(active.moduleId).state).toBe('update-available');
    expect(registry.setEnabled(active.moduleId, false).state).toBe('update-available');
    expect(registry.activate(installation('2')).state).toBe('disabled');
  });

  it('rejects activation before all validation gates pass', () => {
    const registry = new InMemoryInstalledModuleRegistry();

    expect(() =>
      registry.activate(
        installation('1', {
          validation: {
            checkedAt: '2026-07-21T00:00:00Z',
            valid: false,
            checksumValid: false,
            schemaCompatible: true,
            sqliteIntegrity: 'ok',
            message: 'checksum mismatch',
          },
        }),
      ),
    ).toThrow('not fully validated');
    expect(registry.list()).toEqual([]);
  });

  it('rejects malformed source-set digests before activation', () => {
    const registry = new InMemoryInstalledModuleRegistry();

    expect(() =>
      registry.activate(installation('1', { sourceSetDigest: 'sha256:invalid' })),
    ).toThrow('valid SHA-256 source-set digest');
    expect(registry.list()).toEqual([]);
  });

  it('does not disable or remove a required core module', () => {
    const registry = new InMemoryInstalledModuleRegistry();
    const core = registry.activate(
      installation('1', {
        moduleId: 'minimed.core.ru',
        required: true,
      }),
    );

    expect(() => registry.setEnabled(core.moduleId, false)).toThrow('cannot be disabled');
    expect(() => registry.remove(core.moduleId)).toThrow('cannot be removed');
  });

  it('defensively copies installation and validation data', () => {
    const registry = new InMemoryInstalledModuleRegistry();
    const mutableValidation = {
      checkedAt: '2026-07-21T00:00:00Z',
      valid: true,
      checksumValid: true,
      schemaCompatible: true,
      sqliteIntegrity: 'ok' as const,
      message: 'validated',
    };
    const source = installation('1', { validation: mutableValidation });

    registry.activate(source);
    mutableValidation.valid = false;
    const firstRead = registry.get(source.moduleId);
    if (firstRead?.lastValidation) firstRead.lastValidation.valid = false;

    expect(registry.get(source.moduleId)?.lastValidation?.valid).toBe(true);
  });

  it('round-trips the complete active and rollback state through a deterministic snapshot', () => {
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate(installation('1'));
    registry.activate(installation('2', { installedSizeBytes: 2_000 }));
    registry.setEnabled('minimed.clinical.pediatrics.infectious', false);
    registry.markUpdateAvailable('minimed.clinical.pediatrics.infectious');

    const snapshot = registry.snapshot();
    const restored = InMemoryInstalledModuleRegistry.fromSnapshot(snapshot);

    expect(snapshot.schemaVersion).toBe(INSTALLED_MODULE_REGISTRY_SNAPSHOT_VERSION);
    expect(restored.list()).toEqual(registry.list());
    expect(restored.rollback('minimed.clinical.pediatrics.infectious').version).toBe('1');
  });

  it('rejects corrupt, duplicate, and cross-module snapshot entries', () => {
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate(installation('1'));
    const snapshot = registry.snapshot();
    const entry = snapshot.entries[0];
    if (!entry) throw new Error('Expected snapshot entry.');

    expect(() =>
      InMemoryInstalledModuleRegistry.fromSnapshot({ ...snapshot, schemaVersion: 2 }),
    ).toThrow('Unsupported installed-module registry schema');

    expect(() =>
      InMemoryInstalledModuleRegistry.fromSnapshot({
        ...snapshot,
        entries: [entry, entry],
      }),
    ).toThrow('Duplicate installed-module registry entry');

    expect(() =>
      InMemoryInstalledModuleRegistry.fromSnapshot({
        ...snapshot,
        entries: [
          {
            ...entry,
            active: { ...entry.active, moduleId: 'minimed.other' },
          },
        ],
      }),
    ).toThrow('belongs to another module');

    expect(() =>
      InMemoryInstalledModuleRegistry.fromSnapshot({
        ...snapshot,
        entries: [
          {
            ...entry,
            history: [entry.active],
          },
        ],
      }),
    ).toThrow('duplicate module version');

    expect(() =>
      InMemoryInstalledModuleRegistry.fromSnapshot({
        ...snapshot,
        entries: [
          {
            ...entry,
            history: [{ ...entry.active, sourceSetDigest: digest('a') }],
          },
        ],
      }),
    ).toThrow('changes the source-set digest');
  });

  it('rejects unsafe required or unvalidated persisted entries', () => {
    const registry = new InMemoryInstalledModuleRegistry();
    registry.activate(installation('1'));
    const entry = registry.snapshot().entries[0];
    if (!entry) throw new Error('Expected snapshot entry.');

    expect(() =>
      InMemoryInstalledModuleRegistry.fromSnapshot({
        schemaVersion: INSTALLED_MODULE_REGISTRY_SNAPSHOT_VERSION,
        entries: [
          {
            ...entry,
            moduleId: 'minimed.core.ru',
            required: true,
            enabled: false,
            active: {
              ...entry.active,
              moduleId: 'minimed.core.ru',
              required: true,
            },
          },
        ],
      }),
    ).toThrow('cannot be disabled');

    expect(() =>
      InMemoryInstalledModuleRegistry.fromSnapshot({
        schemaVersion: INSTALLED_MODULE_REGISTRY_SNAPSHOT_VERSION,
        entries: [
          {
            ...entry,
            active: {
              ...entry.active,
              validation: {
                ...entry.active.validation,
                valid: false,
                message: 'failed validation',
              },
            },
          },
        ],
      }),
    ).toThrow('not fully validated');
  });
});

describe('PersistentInstalledModuleRegistry', () => {
  it('persists every successful mutation and rehydrates after restart', () => {
    const storage = new MemoryStringStorage();
    const registry = persistentRegistry(storage);

    registry.activate(installation('1'));
    registry.activate(installation('2', { installedSizeBytes: 2_000 }));
    registry.setEnabled('minimed.clinical.pediatrics.infectious', false);
    registry.markUpdateAvailable('minimed.clinical.pediatrics.infectious');

    const reopened = persistentRegistry(storage);
    const active = reopened.get('minimed.clinical.pediatrics.infectious');

    expect(storage.writeCount).toBe(4);
    expect(active?.version).toBe('2');
    expect(active?.state).toBe('update-available');
    expect(active?.enabled).toBe(false);
    expect(active?.previousVersions).toEqual(['1']);
    expect(reopened.rollback('minimed.clinical.pediatrics.infectious').version).toBe('1');
  });

  it('restores the prior in-memory state when a persistence write fails', () => {
    const storage = new MemoryStringStorage();
    const registry = persistentRegistry(storage);
    const active = registry.activate(installation('1'));
    storage.failWrites = true;

    expect(() => registry.setEnabled(active.moduleId, false)).toThrow(
      'Unable to persist installed-module registry mutation',
    );
    expect(registry.get(active.moduleId)?.enabled).toBe(true);

    storage.failWrites = false;
    expect(persistentRegistry(storage).get(active.moduleId)?.enabled).toBe(true);
  });

  it('fails closed on malformed JSON and structurally invalid stored snapshots', () => {
    const malformed = new MemoryStringStorage();
    malformed.seed(STORAGE_KEY, '{invalid');
    expect(() => persistentRegistry(malformed)).toThrow('does not contain valid JSON');

    const invalid = new MemoryStringStorage();
    const badSnapshot: InstalledModuleRegistrySnapshot = {
      schemaVersion: INSTALLED_MODULE_REGISTRY_SNAPSHOT_VERSION,
      entries: [],
    };
    invalid.seed(
      STORAGE_KEY,
      JSON.stringify({ ...badSnapshot, schemaVersion: 999, entries: 'not-an-array' }),
    );
    expect(() => persistentRegistry(invalid)).toThrow(
      'Unsupported installed-module registry schema',
    );
  });

  it('persists removals without leaving stale versions on restart', () => {
    const storage = new MemoryStringStorage();
    const registry = persistentRegistry(storage);
    const active = registry.activate(installation('1'));

    registry.remove(active.moduleId);

    expect(persistentRegistry(storage).list()).toEqual([]);
  });
});
