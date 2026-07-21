import type { ContentPackSeed, EmbeddingProfile } from '@localmed/contracts';
import type { AliasRecord, ChunkRecord, DocumentRecord, SectionRecord } from '@localmed/domain';

import type {
  LexicalHit,
  LexicalSearchRequest,
  MedicalStore,
  StorageHealth,
  VectorHit,
  VectorSearchRequest,
} from './ports';

const DEFAULT_RRF_K = 60;

export interface MedicalStoreMount {
  readonly moduleId: string;
  readonly store: MedicalStore;
  readonly required?: boolean;
  readonly enabled?: boolean;
  readonly searchWeight?: number;
  readonly acceptsSeed?: boolean;
}

export interface MedicalStoreMountStatus {
  readonly moduleId: string;
  readonly required: boolean;
  readonly enabled: boolean;
  readonly searchWeight: number;
}

interface InternalMount extends MedicalStoreMountStatus {
  readonly store: MedicalStore;
  readonly acceptsSeed: boolean;
}

function toInternalMount(mount: MedicalStoreMount): InternalMount {
  if (!mount.moduleId.trim()) throw new Error('Medical-store module ID cannot be blank.');
  const searchWeight = mount.searchWeight ?? 1;
  if (!Number.isFinite(searchWeight) || searchWeight <= 0) {
    throw new Error(`Invalid search weight for module ${mount.moduleId}.`);
  }
  return {
    moduleId: mount.moduleId,
    store: mount.store,
    required: mount.required ?? false,
    enabled: mount.enabled ?? true,
    searchWeight,
    acceptsSeed: mount.acceptsSeed ?? false,
  };
}

function aliasSignature(alias: AliasRecord): string {
  return JSON.stringify([alias.canonicalTerm, alias.alias, alias.category, alias.weight]);
}

function profileSignature(profile: EmbeddingProfile): string {
  return JSON.stringify([
    profile.dimensions,
    profile.vectorFormat,
    profile.normalization,
    profile.generator,
    profile.generatorVersion,
    profile.fingerprint,
  ]);
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

export class MultiMedicalStore implements MedicalStore {
  private readonly mounts = new Map<string, InternalMount>();
  private initialized = false;

  public constructor(mounts: readonly MedicalStoreMount[]) {
    if (mounts.length === 0) throw new Error('MultiMedicalStore requires at least one mount.');
    for (const mount of mounts) {
      const normalized = toInternalMount(mount);
      if (this.mounts.has(normalized.moduleId)) {
        throw new Error(`Duplicate medical-store module ID: ${normalized.moduleId}`);
      }
      this.mounts.set(normalized.moduleId, normalized);
    }
    this.assertRequiredMountsEnabled();
  }

  public listMounts(): readonly MedicalStoreMountStatus[] {
    return [...this.mounts.values()]
      .map(({ moduleId, required, enabled, searchWeight }) => ({
        moduleId,
        required,
        enabled,
        searchWeight,
      }))
      .toSorted((left, right) => left.moduleId.localeCompare(right.moduleId));
  }

  public async initialize(seed?: ContentPackSeed): Promise<StorageHealth> {
    const seedTargets = [...this.mounts.values()].filter((mount) => mount.acceptsSeed);
    if (seed && seedTargets.length !== 1) {
      throw new Error('A seed requires exactly one mounted store with acceptsSeed=true.');
    }

    await Promise.all(
      [...this.mounts.values()].map((mount) =>
        mount.store.initialize(seed && mount.acceptsSeed ? seed : undefined),
      ),
    );
    this.initialized = true;
    try {
      await this.validateComposition();
      return await this.getHealth();
    } catch (cause) {
      this.initialized = false;
      throw cause;
    }
  }

  public async addMount(mount: MedicalStoreMount): Promise<void> {
    const normalized = toInternalMount(mount);
    if (this.mounts.has(normalized.moduleId)) {
      throw new Error(`Duplicate medical-store module ID: ${normalized.moduleId}`);
    }
    if (normalized.required && !normalized.enabled) {
      throw new Error(`Required module ${normalized.moduleId} cannot be disabled.`);
    }

    if (this.initialized) await normalized.store.initialize();
    this.mounts.set(normalized.moduleId, normalized);
    try {
      if (this.initialized) await this.validateComposition();
    } catch (cause) {
      this.mounts.delete(normalized.moduleId);
      if (this.initialized) await normalized.store.close();
      throw cause;
    }
  }

  public async removeMount(moduleId: string): Promise<void> {
    const mount = this.mounts.get(moduleId);
    if (!mount) return;
    if (mount.required) throw new Error(`Required module ${moduleId} cannot be removed.`);
    this.mounts.delete(moduleId);
    await mount.store.close();
  }

  public async setEnabled(moduleId: string, enabled: boolean): Promise<void> {
    const mount = this.mounts.get(moduleId);
    if (!mount) throw new Error(`Unknown module mount: ${moduleId}`);
    if (!enabled && mount.required)
      throw new Error(`Required module ${moduleId} cannot be disabled.`);
    if (mount.enabled === enabled) return;

    const previous = mount.enabled;
    this.mounts.set(moduleId, { ...mount, enabled });
    try {
      if (this.initialized) await this.validateComposition();
    } catch (cause) {
      this.mounts.set(moduleId, { ...mount, enabled: previous });
      throw cause;
    }
  }

  public async getHealth(): Promise<StorageHealth> {
    this.assertInitialized();
    const active = this.activeMounts();
    const health = await Promise.all(active.map((mount) => mount.store.getHealth()));
    const schemaVersion = health[0]?.schemaVersion;
    if (schemaVersion === undefined) throw new Error('No enabled medical-store modules.');

    const sizes = health.map((entry) => entry.sizeBytes);
    const installations = unique(health.map((entry) => entry.installation));
    return {
      schemaVersion,
      sqliteVersion: unique(health.map((entry) => entry.sqliteVersion)).join(' + '),
      fts5Available: health.every((entry) => entry.fts5Available),
      contentPackIds: unique(health.flatMap((entry) => entry.contentPackIds)),
      documentCount: health.reduce((total, entry) => total + entry.documentCount, 0),
      backend: 'multi-store',
      persistent: health.every((entry) => entry.persistent),
      installation: installations.length === 1 ? (installations[0] ?? 'mixed') : 'mixed',
      sizeBytes: sizes.every((size): size is number => size !== null)
        ? sizes.reduce((total, size) => total + size, 0)
        : null,
    };
  }

  public async listDocuments(): Promise<readonly DocumentRecord[]> {
    this.assertInitialized();
    return (await Promise.all(this.activeMounts().map((mount) => mount.store.listDocuments())))
      .flat()
      .toSorted((left, right) => left.title.localeCompare(right.title));
  }

  public async getDocument(id: string): Promise<DocumentRecord | null> {
    return this.firstMatch((store) => store.getDocument(id));
  }

  public async getDocumentByVersionId(versionId: string): Promise<DocumentRecord | null> {
    return this.firstMatch((store) => store.getDocumentByVersionId(versionId));
  }

  public async getSectionsByDocument(documentId: string): Promise<readonly SectionRecord[]> {
    const mount = await this.findMount((store) => store.getDocument(documentId));
    return mount ? mount.store.getSectionsByDocument(documentId) : [];
  }

  public async getSection(id: string): Promise<SectionRecord | null> {
    return this.firstMatch((store) => store.getSection(id));
  }

  public async getChunksBySection(sectionId: string): Promise<readonly ChunkRecord[]> {
    const mount = await this.findMount((store) => store.getSection(sectionId));
    return mount ? mount.store.getChunksBySection(sectionId) : [];
  }

  public async getChunk(id: string): Promise<ChunkRecord | null> {
    return this.firstMatch((store) => store.getChunk(id));
  }

  public async getChunkWindow(chunkId: string, radius: number): Promise<readonly ChunkRecord[]> {
    const mount = await this.findMount((store) => store.getChunk(chunkId));
    return mount ? mount.store.getChunkWindow(chunkId, radius) : [];
  }

  public async listAliases(): Promise<readonly AliasRecord[]> {
    this.assertInitialized();
    const aliases = (
      await Promise.all(this.activeMounts().map((mount) => mount.store.listAliases()))
    ).flat();
    const byId = new Map<string, AliasRecord>();
    for (const alias of aliases) byId.set(alias.id, alias);
    return [...byId.values()].toSorted((left, right) => left.alias.localeCompare(right.alias));
  }

  public async listEmbeddingProfiles(): Promise<readonly EmbeddingProfile[]> {
    this.assertInitialized();
    const profiles = (
      await Promise.all(this.activeMounts().map((mount) => mount.store.listEmbeddingProfiles()))
    ).flat();
    const byId = new Map<string, EmbeddingProfile>();
    for (const profile of profiles) byId.set(profile.id, profile);
    return [...byId.values()].toSorted((left, right) => left.id.localeCompare(right.id));
  }

  public async search(request: LexicalSearchRequest): Promise<readonly LexicalHit[]> {
    this.assertInitialized();
    const active = this.activeMounts();
    const resultSets = await Promise.all(
      active.map(async (mount) => ({
        mount,
        hits: await mount.store.search(request),
      })),
    );
    const fused = new Map<string, LexicalHit>();
    for (const { mount, hits } of resultSets) {
      hits.forEach((hit, index) => {
        const candidate = {
          ...hit,
          rank: mount.searchWeight / (DEFAULT_RRF_K + index + 1),
        };
        const existing = fused.get(hit.chunk.id);
        if (!existing || candidate.rank > existing.rank) fused.set(hit.chunk.id, candidate);
      });
    }
    return [...fused.values()]
      .toSorted((left, right) => right.rank - left.rank)
      .slice(0, request.limit);
  }

  public async searchVector(request: VectorSearchRequest): Promise<readonly VectorHit[]> {
    this.assertInitialized();
    const resultSets = await Promise.all(
      this.activeMounts().map(async (mount) => ({
        mount,
        hits: await mount.store.searchVector(request),
      })),
    );
    const fused = new Map<string, VectorHit>();
    for (const { mount, hits } of resultSets) {
      for (const hit of hits) {
        const candidate = { ...hit, score: hit.score * mount.searchWeight };
        const existing = fused.get(hit.chunk.id);
        if (!existing || candidate.score > existing.score) fused.set(hit.chunk.id, candidate);
      }
    }
    return [...fused.values()]
      .toSorted((left, right) => right.score - left.score)
      .slice(0, request.limit);
  }

  public async close(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.mounts.values()].map((mount) => mount.store.close()),
    );
    this.initialized = false;
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) throw new Error(`Unable to close ${failures.length} medical stores.`);
  }

  private activeMounts(): readonly InternalMount[] {
    this.assertRequiredMountsEnabled();
    return [...this.mounts.values()]
      .filter((mount) => mount.enabled)
      .toSorted(
        (left, right) =>
          right.searchWeight - left.searchWeight || left.moduleId.localeCompare(right.moduleId),
      );
  }

  private async validateComposition(): Promise<void> {
    const active = this.activeMounts();
    if (active.length === 0) throw new Error('At least one medical-store module must be enabled.');

    const health = await Promise.all(active.map((mount) => mount.store.getHealth()));
    const schemaVersions = unique(health.map((entry) => entry.schemaVersion));
    if (schemaVersions.length !== 1) {
      throw new Error(`Incompatible module schema versions: ${schemaVersions.join(', ')}`);
    }

    const packIds = new Set<string>();
    for (const entry of health) {
      for (const packId of entry.contentPackIds) {
        if (packIds.has(packId)) throw new Error(`Duplicate active content-pack ID: ${packId}`);
        packIds.add(packId);
      }
    }

    const documentIds = new Set<string>();
    const versionIds = new Set<string>();
    for (const documents of await Promise.all(active.map((mount) => mount.store.listDocuments()))) {
      for (const document of documents) {
        if (documentIds.has(document.id))
          throw new Error(`Duplicate active document ID: ${document.id}`);
        if (versionIds.has(document.version.id)) {
          throw new Error(`Duplicate active document-version ID: ${document.version.id}`);
        }
        documentIds.add(document.id);
        versionIds.add(document.version.id);
      }
    }

    const aliases = new Map<string, string>();
    for (const moduleAliases of await Promise.all(
      active.map((mount) => mount.store.listAliases()),
    )) {
      for (const alias of moduleAliases) {
        const signature = aliasSignature(alias);
        const existing = aliases.get(alias.id);
        if (existing && existing !== signature)
          throw new Error(`Conflicting alias ID: ${alias.id}`);
        aliases.set(alias.id, signature);
      }
    }

    const profiles = new Map<string, string>();
    for (const moduleProfiles of await Promise.all(
      active.map((mount) => mount.store.listEmbeddingProfiles()),
    )) {
      for (const profile of moduleProfiles) {
        const signature = profileSignature(profile);
        const existing = profiles.get(profile.id);
        if (existing && existing !== signature) {
          throw new Error(`Incompatible embedding profile: ${profile.id}`);
        }
        profiles.set(profile.id, signature);
      }
    }
  }

  private async firstMatch<T>(
    lookup: (store: MedicalStore) => Promise<T | null>,
  ): Promise<T | null> {
    this.assertInitialized();
    for (const mount of this.activeMounts()) {
      const result = await lookup(mount.store);
      if (result !== null) return result;
    }
    return null;
  }

  private async findMount<T>(
    lookup: (store: MedicalStore) => Promise<T | null>,
  ): Promise<InternalMount | null> {
    this.assertInitialized();
    for (const mount of this.activeMounts()) {
      if ((await lookup(mount.store)) !== null) return mount;
    }
    return null;
  }

  private assertRequiredMountsEnabled(): void {
    for (const mount of this.mounts.values()) {
      if (mount.required && !mount.enabled) {
        throw new Error(`Required module ${mount.moduleId} cannot be disabled.`);
      }
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('MultiMedicalStore is not initialized.');
  }
}
