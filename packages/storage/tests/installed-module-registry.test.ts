import { describe, expect, it } from 'vitest';

import {
  InMemoryInstalledModuleRegistry,
  type ModuleVersionInstallation,
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
});
