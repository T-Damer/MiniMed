import { ContentModuleValidationSchema, type InstalledContentModule } from '@localmed/contracts';

type ModuleValidation = NonNullable<InstalledContentModule['lastValidation']>;

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

export const INSTALLED_MODULE_REGISTRY_SNAPSHOT_VERSION = 1 as const;
export const DEFAULT_INSTALLED_MODULE_REGISTRY_STORAGE_KEY = 'localmed.installed-modules.v1';

export interface InstalledModuleRegistrySnapshotEntry {
  readonly moduleId: string;
  readonly required: boolean;
  readonly enabled: boolean;
  readonly updateAvailable: boolean;
  readonly active: ModuleVersionInstallation;
  readonly history: readonly ModuleVersionInstallation[];
}

export interface InstalledModuleRegistrySnapshot {
  readonly schemaVersion: typeof INSTALLED_MODULE_REGISTRY_SNAPSHOT_VERSION;
  readonly entries: readonly InstalledModuleRegistrySnapshotEntry[];
}

export interface InstalledModuleRegistryPersistence {
  load(): unknown | null;
  save(snapshot: InstalledModuleRegistrySnapshot): void;
}

export interface StringKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class WebStorageInstalledModuleRegistryPersistence
  implements InstalledModuleRegistryPersistence
{
  public constructor(
    private readonly storage: StringKeyValueStorage,
    private readonly key = DEFAULT_INSTALLED_MODULE_REGISTRY_STORAGE_KEY,
  ) {}

  public load(): unknown | null {
    const serialized = this.storage.getItem(this.key);
    if (serialized === null) return null;
    try {
      return JSON.parse(serialized) as unknown;
    } catch (cause) {
      throw new Error('Installed-module registry storage does not contain valid JSON.', { cause });
    }
  }

  public save(snapshot: InstalledModuleRegistrySnapshot): void {
    this.storage.setItem(this.key, JSON.stringify(snapshot));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function requireSafeSize(value: unknown, label: string): number {
  if (typeof value !== 'number' || value < 0 || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function cloneValidation(validation: ModuleValidation): ModuleValidation {
  return { ...validation };
}

function cloneInstallation(installation: ModuleVersionInstallation): ModuleVersionInstallation {
  return {
    ...installation,
    validation: cloneValidation(installation.validation),
  };
}

function assertDigest(value: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error('Installed module requires a valid SHA-256 source-set digest.');
  }
}

function normalizeInstallation(
  value: unknown,
  label = 'Installed module version',
): ModuleVersionInstallation {
  const installation = requireRecord(value, label);
  const normalized: ModuleVersionInstallation = {
    moduleId: requireString(installation.moduleId, `${label} moduleId`),
    version: requireString(installation.version, `${label} version`),
    required: requireBoolean(installation.required, `${label} required`),
    installedAt: requireString(installation.installedAt, `${label} installedAt`),
    installedSizeBytes: requireSafeSize(
      installation.installedSizeBytes,
      `${label} installedSizeBytes`,
    ),
    sourceSetDigest: requireString(installation.sourceSetDigest, `${label} sourceSetDigest`),
    validation: ContentModuleValidationSchema.parse(installation.validation),
  };
  assertDigest(normalized.sourceSetDigest);
  const validation = normalized.validation;
  if (
    !validation.valid ||
    !validation.checksumValid ||
    !validation.schemaCompatible ||
    validation.sqliteIntegrity !== 'ok'
  ) {
    throw new Error(`Module ${normalized.moduleId}@${normalized.version} is not fully validated.`);
  }
  return cloneInstallation(normalized);
}

function assertUniqueImmutableVersion(
  moduleId: string,
  versionDigests: Map<string, string>,
  installation: ModuleVersionInstallation,
  label: string,
): void {
  const existingDigest = versionDigests.get(installation.version);
  if (existingDigest === installation.sourceSetDigest) {
    throw new Error(`${label} contains a duplicate module version.`);
  }
  if (existingDigest !== undefined) {
    throw new Error(
      `${label} changes the source-set digest for immutable module version ${moduleId}@${installation.version}.`,
    );
  }
  versionDigests.set(installation.version, installation.sourceSetDigest);
}

function parseSnapshotEntry(value: unknown, index: number): InstalledModuleRegistrySnapshotEntry {
  const label = `Installed-module registry entry ${index}`;
  const entry = requireRecord(value, label);
  const moduleId = requireString(entry.moduleId, `${label} moduleId`);
  const required = requireBoolean(entry.required, `${label} required`);
  const enabled = requireBoolean(entry.enabled, `${label} enabled`);
  const updateAvailable = requireBoolean(entry.updateAvailable, `${label} updateAvailable`);
  if (required && !enabled) throw new Error(`Required module ${moduleId} cannot be disabled.`);

  const active = normalizeInstallation(entry.active, `${label} active version`);
  if (active.moduleId !== moduleId) {
    throw new Error(`${label} active version belongs to another module.`);
  }
  if (active.required !== required) {
    throw new Error(`${label} active version has a mismatched required flag.`);
  }
  if (!Array.isArray(entry.history)) throw new Error(`${label} history must be an array.`);
  const history = entry.history.map((version, historyIndex) =>
    normalizeInstallation(version, `${label} history version ${historyIndex}`),
  );
  const versionDigests = new Map([[active.version, active.sourceSetDigest]]);
  for (const version of history) {
    if (version.moduleId !== moduleId) {
      throw new Error(`${label} history contains another module.`);
    }
    if (version.required !== required) {
      throw new Error(`${label} history has a mismatched required flag.`);
    }
    assertUniqueImmutableVersion(moduleId, versionDigests, version, label);
  }
  return {
    moduleId,
    required,
    enabled,
    updateAvailable,
    active,
    history,
  };
}

export function parseInstalledModuleRegistrySnapshot(
  value: unknown,
): InstalledModuleRegistrySnapshot {
  const snapshot = requireRecord(value, 'Installed-module registry snapshot');
  if (snapshot.schemaVersion !== INSTALLED_MODULE_REGISTRY_SNAPSHOT_VERSION) {
    throw new Error(
      `Unsupported installed-module registry schema: ${String(snapshot.schemaVersion)}.`,
    );
  }
  if (!Array.isArray(snapshot.entries)) {
    throw new Error('Installed-module registry entries must be an array.');
  }
  const entries = snapshot.entries.map(parseSnapshotEntry);
  const moduleIds = new Set<string>();
  for (const entry of entries) {
    if (moduleIds.has(entry.moduleId)) {
      throw new Error(`Duplicate installed-module registry entry: ${entry.moduleId}.`);
    }
    moduleIds.add(entry.moduleId);
  }
  return {
    schemaVersion: INSTALLED_MODULE_REGISTRY_SNAPSHOT_VERSION,
    entries: entries.toSorted((left, right) => left.moduleId.localeCompare(right.moduleId)),
  };
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
    lastValidation: cloneValidation(entry.active.validation),
  };
}

export class InMemoryInstalledModuleRegistry implements InstalledModuleRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  public static fromSnapshot(value: unknown): InMemoryInstalledModuleRegistry {
    const registry = new InMemoryInstalledModuleRegistry();
    for (const entry of parseInstalledModuleRegistrySnapshot(value).entries) {
      registry.entries.set(entry.moduleId, {
        required: entry.required,
        enabled: entry.enabled,
        updateAvailable: entry.updateAvailable,
        active: cloneInstallation(entry.active),
        history: entry.history.map(cloneInstallation),
      });
    }
    return registry;
  }

  public snapshot(): InstalledModuleRegistrySnapshot {
    return {
      schemaVersion: INSTALLED_MODULE_REGISTRY_SNAPSHOT_VERSION,
      entries: [...this.entries.entries()]
        .map(([moduleId, entry]) => ({
          moduleId,
          required: entry.required,
          enabled: entry.enabled,
          updateAvailable: entry.updateAvailable,
          active: cloneInstallation(entry.active),
          history: entry.history.map(cloneInstallation),
        }))
        .toSorted((left, right) => left.moduleId.localeCompare(right.moduleId)),
    };
  }

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
    const normalized = normalizeInstallation(installation);
    const existing = this.entries.get(normalized.moduleId);
    if (existing?.required !== undefined && existing.required !== normalized.required) {
      throw new Error(`Required flag changed for installed module ${normalized.moduleId}.`);
    }

    const installedVersion = existing
      ? [existing.active, ...existing.history].find(
          (candidate) => candidate.version === normalized.version,
        )
      : undefined;
    if (
      installedVersion !== undefined &&
      installedVersion.sourceSetDigest !== normalized.sourceSetDigest
    ) {
      throw new Error(
        `Immutable module version ${normalized.moduleId}@${normalized.version} has a conflicting source-set digest.`,
      );
    }

    if (existing?.active.version === normalized.version) {
      const refreshed: RegistryEntry = {
        ...existing,
        active: normalized,
        updateAvailable: false,
      };
      this.entries.set(normalized.moduleId, refreshed);
      return toPublic(refreshed);
    }

    const history = existing
      ? [
          existing.active,
          ...existing.history.filter((candidate) => candidate.version !== normalized.version),
        ]
      : [];
    const next: RegistryEntry = {
      required: normalized.required,
      enabled: existing?.enabled ?? true,
      updateAvailable: false,
      active: normalized,
      history,
    };
    this.entries.set(normalized.moduleId, next);
    return toPublic(next);
  }

  public setEnabled(moduleId: string, enabled: boolean): InstalledContentModule {
    const entry = this.requireEntry(moduleId);
    if (!enabled && entry.required)
      throw new Error(`Required module ${moduleId} cannot be disabled.`);
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

export class PersistentInstalledModuleRegistry implements InstalledModuleRegistry {
  private registry: InMemoryInstalledModuleRegistry;

  public constructor(private readonly persistence: InstalledModuleRegistryPersistence) {
    const snapshot = persistence.load();
    this.registry =
      snapshot === null
        ? new InMemoryInstalledModuleRegistry()
        : InMemoryInstalledModuleRegistry.fromSnapshot(snapshot);
  }

  public list(): readonly InstalledContentModule[] {
    return this.registry.list();
  }

  public get(moduleId: string): InstalledContentModule | null {
    return this.registry.get(moduleId);
  }

  public activate(installation: ModuleVersionInstallation): InstalledContentModule {
    return this.commit(() => this.registry.activate(installation));
  }

  public setEnabled(moduleId: string, enabled: boolean): InstalledContentModule {
    return this.commit(() => this.registry.setEnabled(moduleId, enabled));
  }

  public markUpdateAvailable(moduleId: string): InstalledContentModule {
    return this.commit(() => this.registry.markUpdateAvailable(moduleId));
  }

  public rollback(moduleId: string): InstalledContentModule {
    return this.commit(() => this.registry.rollback(moduleId));
  }

  public remove(moduleId: string): void {
    this.commit(() => this.registry.remove(moduleId));
  }

  public snapshot(): InstalledModuleRegistrySnapshot {
    return this.registry.snapshot();
  }

  private commit<T>(mutation: () => T): T {
    const previous = this.registry.snapshot();
    const result = mutation();
    try {
      this.persistence.save(this.registry.snapshot());
      return result;
    } catch (cause) {
      this.registry = InMemoryInstalledModuleRegistry.fromSnapshot(previous);
      throw new Error('Unable to persist installed-module registry mutation.', { cause });
    }
  }
}
