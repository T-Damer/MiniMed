import type {
  ContentModuleValidationSchema,
  InstalledContentModule,
} from '@localmed/contracts';
import type { z } from 'zod';

type ModuleValidation = z.infer<typeof ContentModuleValidationSchema>;

export interface ModuleVersionInstallation {
  readonly moduleId: string;
  readonly version: string;
  readonly required: boolean;
  readonly installedAt: string;
  readonly installedSizeBytes: number;
  readonly sourceSetDigest: string;
  readonly validation: ModuleValidation;
}

export interface InstalledModuleRegistry {
  list(): readonly InstalledContentModule[];
  get(moduleId: string): InstalledContentModule | null;
  activate(installation: ModuleVersionInstallation): InstalledContentModule;
  setEnabled(moduleId: string, enabled: boolean): InstalledContentModule;
  markUpdateAvailable(moduleId: string): InstalledContentModule;
  rollback(moduleId: string): InstalledContentModule;
  remove(moduleId: string): void;
}

interface RegistryEntry {
  readonly required: boolean;
  readonly enabled: boolean;
  readonly updateAvailable: boolean;
  readonly active: ModuleVersionInstallation;
  readonly history: readonly ModuleVersionInstallation[];
}

function assertDigest(value: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error('Installed module requires a valid SHA-256 source-set digest.');
  }
}

function assertValidated(installation: ModuleVersionInstallation): void {
  assertDigest(installation.sourceSetDigest);
  if (installation.installedSizeBytes < 0 || !Number.isSafeInteger(installation.installedSizeBytes)) {
    throw new Error('Installed module size must be a non-negative safe integer.');
  }
  const validation = installation.validation;
  if (
    !validation.valid ||
    !validation.checksumValid ||
    !validation.schemaCompatible ||
    validation.sqliteIntegrity !== 'ok'
  ) {
    throw new Error(`Module ${installation.moduleId}@${installation.version} is not fully validated.`);
  }
}

function toPublic(entry: RegistryEntry): InstalledContentModule {
  return {
    moduleId: entry.active.moduleId,
    version: entry.active.version,
    state: entry.updateAvailable ? 'update-available' : entry.enabled ? 'installed' : 'disabled',
    enabled: entry.enabled,
    installedAt: entry.active.installedAt,
    installedSizeBytes: entry.active.installedSizeBytes,
    activeSourceSetDigest: entry.active.sourceSetDigest,
    previousVersions: entry.history.map((version) => version.version),
    lastValidation: entry.active.validation,
  };
}

export class InMemoryInstalledModuleRegistry implements InstalledModuleRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  public list(): readonly InstalledContentModule[] {
    return [...this.entries.values()]
      .map(toPublic)
      .toSorted((left, right) => left.moduleId.localeCompare(right.moduleId));
  }

  public get(moduleId: string): InstalledContentModule | null {
    const entry = this.entries.get(moduleId);
    return entry ? toPublic(entry) : null;
  }

  public activate(installation: ModuleVersionInstallation): InstalledContentModule {
    assertValidated(installation);
    const existing = this.entries.get(installation.moduleId);
    if (existing?.required !== undefined && existing.required !== installation.required) {
      throw new Error(`Required flag changed for installed module ${installation.moduleId}.`);
    }

    if (
      existing?.active.version === installation.version &&
      existing.active.sourceSetDigest === installation.sourceSetDigest
    ) {
      const refreshed: RegistryEntry = {
        ...existing,
        active: installation,
        updateAvailable: false,
      };
      this.entries.set(installation.moduleId, refreshed);
      return toPublic(refreshed);
    }

    const history = existing
      ? [
          existing.active,
          ...existing.history.filter(
            (candidate) =>
              candidate.version !== installation.version ||
              candidate.sourceSetDigest !== installation.sourceSetDigest,
          ),
        ]
      : [];
    const next: RegistryEntry = {
      required: installation.required,
      enabled: existing?.enabled ?? true,
      updateAvailable: false,
      active: installation,
      history,
    };
    this.entries.set(installation.moduleId, next);
    return toPublic(next);
  }

  public setEnabled(moduleId: string, enabled: boolean): InstalledContentModule {
    const entry = this.requireEntry(moduleId);
    if (!enabled && entry.required) throw new Error(`Required module ${moduleId} cannot be disabled.`);
    const next = { ...entry, enabled };
    this.entries.set(moduleId, next);
    return toPublic(next);
  }

  public markUpdateAvailable(moduleId: string): InstalledContentModule {
    const entry = this.requireEntry(moduleId);
    const next = { ...entry, updateAvailable: true };
    this.entries.set(moduleId, next);
    return toPublic(next);
  }

  public rollback(moduleId: string): InstalledContentModule {
    const entry = this.requireEntry(moduleId);
    const previous = entry.history[0];
    if (!previous) throw new Error(`Module ${moduleId} has no validated rollback version.`);
    const next: RegistryEntry = {
      ...entry,
      active: previous,
      history: [entry.active, ...entry.history.slice(1)],
      updateAvailable: false,
    };
    this.entries.set(moduleId, next);
    return toPublic(next);
  }

  public remove(moduleId: string): void {
    const entry = this.requireEntry(moduleId);
    if (entry.required) throw new Error(`Required module ${moduleId} cannot be removed.`);
    this.entries.delete(moduleId);
  }

  private requireEntry(moduleId: string): RegistryEntry {
    const entry = this.entries.get(moduleId);
    if (!entry) throw new Error(`Module ${moduleId} is not installed.`);
    return entry;
  }
}
