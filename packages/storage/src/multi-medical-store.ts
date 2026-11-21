import {
  type ContentPackSeed,
  type CoreIdentityHit,
  type DefinitionReferenceReply,
  type DefinitionReferenceRequest,
  DefinitionReferenceRequestSchema,
  type EmbeddingProfile,
} from '@localmed/contracts';
import type { AliasRecord, ChunkRecord, DocumentRecord, SectionRecord } from '@localmed/domain';
import {
  createStorageTimeSlicer,
  SortedListingMemo,
  stableSortSliced,
} from '@localmed/storage/sliced-sort';
import type {
  LexicalHit,
  LexicalMatch,
  LexicalSearchRequest,
  MedicalStore,
  SearchDocumentDescriptor,
  StorageHealth,
  VectorHit,
  VectorSearchRequest,
} from './ports';

/**
 * One default-locale collator for every sort here: the same order as `a.localeCompare(b)` without
 * arguments, without its per-call setup — sorting the 20 000 navigation titles that way took about
 * a second of main thread at phone speed.
 */
const textCollator = new Intl.Collator();

/** Shared by every combined store of the page: a rebuilt core mounts the same lists. */
const aliasesMemo = new SortedListingMemo<AliasRecord>();
const navigationDocumentsMemo = new SortedListingMemo<DocumentRecord>();

function compareText(left: string, right: string): number {
  return textCollator.compare(left, right);
}

const DEFAULT_RRF_K = 60;
const VALIDATION_READ_BATCH = 16;

export interface MedicalStoreMount {
  readonly moduleId: string;
  readonly store: MedicalStore;
  readonly required?: boolean;
  readonly enabled?: boolean;
  readonly searchWeight?: number;
  readonly acceptsSeed?: boolean;
  /** Isolated source-reference capability; never exposed as a whole source document. */
  readonly definitionReference?: { readonly editionId: string; readonly entries: number };
}

export interface MedicalStoreMountStatus {
  readonly definitionReference?: { readonly editionId: string; readonly entries: number };
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
    ...(mount.definitionReference ? { definitionReference: mount.definitionReference } : {}),
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

/** Keep worker and bridge replies from the whole library from arriving at once. */
async function* readValidationRecords<T>(
  mounts: readonly InternalMount[],
  read: (mount: InternalMount) => Promise<T>,
): AsyncGenerator<T> {
  for (let start = 0; start < mounts.length; start += VALIDATION_READ_BATCH) {
    yield* await Promise.all(mounts.slice(start, start + VALIDATION_READ_BATCH).map(read));
  }
}

export class MultiMedicalStore implements MedicalStore {
  private readonly mounts = new Map<string, InternalMount>();
  private initialized = false;
  private documentOwners = new Map<string, InternalMount>();
  private validatedAliases: readonly AliasRecord[] | undefined;
  private aliasesPending: Promise<readonly AliasRecord[]> | undefined;
  /** The aliases `validateComposition` checked, waiting for the first `listAliases` to sort them. */
  private checkedAliases:
    | {
        readonly inputs: readonly (readonly AliasRecord[])[];
        readonly byId: ReadonlyMap<string, AliasRecord>;
      }
    | undefined;

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

  public async reference(untrusted: DefinitionReferenceRequest): Promise<DefinitionReferenceReply> {
    this.assertInitialized();
    const request = DefinitionReferenceRequestSchema.parse(untrusted);
    const mount = this.mounts.get(request.moduleId);
    if (
      !mount?.enabled ||
      !mount.definitionReference ||
      mount.definitionReference.editionId !== request.editionId
    )
      return { op: 'unavailable' };
    if (!mount.store.reference) throw new Error('Installed reference backend is unavailable.');
    return mount.store.reference(request);
  }

  public listMounts(): readonly MedicalStoreMountStatus[] {
    return [...this.mounts.values()]
      .map(({ moduleId, required, enabled, searchWeight }) => ({
        moduleId,
        required,
        enabled,
        searchWeight,
      }))
      .toSorted((left, right) => compareText(left.moduleId, right.moduleId));
  }

  public async initialize(seed?: ContentPackSeed): Promise<StorageHealth> {
    this.documentOwners.clear();
    this.validatedAliases = undefined;
    this.aliasesPending = undefined;
    this.checkedAliases = undefined;
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
      return this.combineHealth(await this.validateComposition());
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
    for (const [id, owner] of this.documentOwners) {
      if (owner === mount) this.documentOwners.delete(id);
    }
    this.validatedAliases = undefined;
    this.aliasesPending = undefined;
    this.checkedAliases = undefined;
    await mount.store.close();
  }

  public async setEnabled(moduleId: string, enabled: boolean): Promise<void> {
    const mount = this.mounts.get(moduleId);
    if (!mount) throw new Error(`Unknown module mount: ${moduleId}`);
    if (!enabled && mount.required)
      throw new Error(`Required module ${moduleId} cannot be disabled.`);
    if (mount.enabled === enabled) return;

    this.mounts.set(moduleId, { ...mount, enabled });
    try {
      if (this.initialized) await this.validateComposition();
    } catch (cause) {
      this.mounts.set(moduleId, mount);
      throw cause;
    }
  }

  public async getHealth(): Promise<StorageHealth> {
    this.assertInitialized();
    const active = this.activeMounts();
    return this.combineHealth(await Promise.all(active.map((mount) => mount.store.getHealth())));
  }

  private combineHealth(health: readonly StorageHealth[]): StorageHealth {
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
      .toSorted((left, right) => compareText(left.title, right.title));
  }

  public async listNavigationDocuments(): Promise<readonly DocumentRecord[]> {
    this.assertInitialized();
    const inputs = await Promise.all(
      this.activeMounts().map(({ store }) =>
        store.listNavigationDocuments ? store.listNavigationDocuments() : store.listDocuments(),
      ),
    );
    // Tens of thousands of titles: sorted in slices, and not again while the mounted stores hand
    // out the same lists (a core rebuilt without a change in what is installed).
    const kept = navigationDocumentsMemo.find(inputs);
    if (kept) return kept;
    const sorted = await stableSortSliced(inputs.flat(), (left, right) =>
      compareText(left.title, right.title),
    );
    navigationDocumentsMemo.keep(inputs, sorted);
    return sorted;
  }

  public async lookupCoreIdentities(query: string): Promise<readonly CoreIdentityHit[]> {
    this.assertInitialized();
    const hits = (
      await Promise.all(
        this.activeMounts().map(({ store }) => store.lookupCoreIdentities?.(query) ?? []),
      )
    ).flat();
    return [...new Map(hits.map((hit) => [JSON.stringify(hit.target), hit])).values()];
  }

  public async listCoreIdentityNames(): Promise<readonly string[]> {
    this.assertInitialized();
    const names = await Promise.all(
      this.activeMounts().map(({ store }) => store.listCoreIdentityNames?.() ?? []),
    );
    return [...new Set(names.flat())];
  }

  public async listSearchDocuments(): Promise<readonly SearchDocumentDescriptor[]> {
    this.assertInitialized();
    return (
      await Promise.all(
        this.activeMounts().map(({ store }) =>
          store.listSearchDocuments ? store.listSearchDocuments() : store.listDocuments(),
        ),
      )
    ).flat();
  }

  public async getDocument(
    id: string,
    projection?: 'medication-catalog',
  ): Promise<DocumentRecord | null> {
    this.assertInitialized();
    const owner = this.documentOwner(id);
    return (projection ? owner?.getDocument(id, projection) : owner?.getDocument(id)) ?? null;
  }

  public async getDocumentByVersionId(versionId: string): Promise<DocumentRecord | null> {
    return this.firstMatch((store) => store.getDocumentByVersionId(versionId));
  }

  public async getSectionsByDocument(documentId: string): Promise<readonly SectionRecord[]> {
    this.assertInitialized();
    return this.documentOwner(documentId)?.getSectionsByDocument(documentId) ?? [];
  }

  public async getSection(id: string): Promise<SectionRecord | null> {
    return this.firstMatch((store) => store.getSection(id));
  }

  public async getChunksByDocument(documentId: string): Promise<readonly ChunkRecord[]> {
    this.assertInitialized();
    return this.documentOwner(documentId)?.getChunksByDocument(documentId) ?? [];
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
    if (this.validatedAliases) return this.validatedAliases;
    // One merge for concurrent callers; a failed one is not kept.
    this.aliasesPending ??= this.mergeAliases().catch((cause: unknown) => {
      this.aliasesPending = undefined;
      this.checkedAliases = undefined;
      throw cause;
    });
    return this.aliasesPending;
  }

  /**
   * Every alias of the active mounts, one per id, in the order of their text. With the drug packs
   * mounted that is hundreds of thousands of strings: sorted in slices, and not again while the
   * mounts hand out the same lists.
   */
  private async mergeAliases(): Promise<readonly AliasRecord[]> {
    // The lists checked at the start are used as they are: the mounts are not asked again.
    const checked = this.checkedAliases;
    const inputs =
      checked?.inputs ??
      (await Promise.all(this.activeMounts().map((mount) => mount.store.listAliases())));
    let sorted = aliasesMemo.find(inputs);
    if (!sorted) {
      let byId = checked?.byId;
      if (!byId) {
        const merged = new Map<string, AliasRecord>();
        for (const moduleAliases of inputs) {
          for (const alias of moduleAliases) merged.set(alias.id, alias);
        }
        byId = merged;
      }
      sorted = await stableSortSliced([...byId.values()], (left, right) =>
        compareText(left.alias, right.alias),
      );
      aliasesMemo.keep(inputs, sorted);
    }
    this.checkedAliases = undefined;
    this.validatedAliases = sorted;
    return sorted;
  }

  public async listEmbeddingProfiles(): Promise<readonly EmbeddingProfile[]> {
    this.assertInitialized();
    const profiles = (
      await Promise.all(this.activeMounts().map((mount) => mount.store.listEmbeddingProfiles()))
    ).flat();
    const byId = new Map<string, EmbeddingProfile>();
    for (const profile of profiles) byId.set(profile.id, profile);
    return [...byId.values()].toSorted((left, right) => compareText(left.id, right.id));
  }

  public async search(request: LexicalSearchRequest): Promise<readonly LexicalHit[]> {
    this.assertInitialized();
    const active = this.activeMounts();
    if (request.compactDocumentMetadata && active.length > 1) {
      return this.searchCompact(active, request);
    }
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

  private async searchCompact(
    mounts: readonly InternalMount[],
    request: LexicalSearchRequest,
  ): Promise<readonly LexicalHit[]> {
    const documentIds = request.filters.documentIds;
    const idsByMount = new Map<InternalMount, string[]>();
    if (documentIds?.length) {
      for (const id of documentIds) {
        const owner = this.documentOwners.get(id);
        if (!owner) continue;
        const ids = idsByMount.get(owner);
        if (ids) ids.push(id);
        else idsByMount.set(owner, [id]);
      }
      mounts = mounts.filter((mount) => idsByMount.has(mount));
    }
    const ranked: readonly {
      mount: InternalMount;
      matches: readonly (LexicalMatch & { readonly hit?: LexicalHit })[];
    }[] = await Promise.all(
      mounts.map(async (mount) => {
        const { store } = mount;
        const ids = idsByMount.get(mount);
        const scoped = ids
          ? { ...request, filters: { ...request.filters, documentIds: ids } }
          : request;
        if (store.rankLexicalMatches && store.hydrateLexicalMatches) {
          return { mount, matches: await store.rankLexicalMatches(scoped) };
        }
        const hits = await store.search(scoped);
        return {
          mount,
          matches: hits.map((hit) => ({ chunkId: hit.chunk.id, rank: hit.rank, hit })),
        };
      }),
    );
    const fused = new Map<
      string,
      { mount: InternalMount; match: LexicalMatch; hit?: LexicalHit }
    >();
    for (const { mount, matches } of ranked) {
      for (const [index, match] of matches.entries()) {
        const rank = mount.searchWeight / (DEFAULT_RRF_K + index + 1);
        const existing = fused.get(match.chunkId);
        if (!existing || rank > existing.match.rank) {
          fused.set(match.chunkId, {
            mount,
            match: { chunkId: match.chunkId, rank },
            ...(match.hit ? { hit: { ...match.hit, rank } } : {}),
          });
        }
      }
    }
    const chosen = [...fused.values()]
      .sort((left, right) => right.match.rank - left.match.rank)
      .slice(0, request.limit);
    const waiting = new Map<InternalMount, LexicalMatch[]>();
    const byId = new Map<string, LexicalHit>();
    for (const { mount, match, hit } of chosen) {
      if (hit) {
        byId.set(match.chunkId, hit);
        continue;
      }
      const matches = waiting.get(mount);
      if (matches) matches.push(match);
      else waiting.set(mount, [match]);
    }
    await Promise.all(
      [...waiting].map(async ([{ store }, matches]) => {
        const hits = await store.hydrateLexicalMatches?.(matches, true);
        for (const hit of hits ?? []) byId.set(hit.chunk.id, hit);
      }),
    );
    return chosen.flatMap(({ match }) => {
      const hit = byId.get(match.chunkId);
      return hit ? [hit] : [];
    });
  }

  public async searchVector(request: VectorSearchRequest): Promise<readonly VectorHit[]> {
    this.assertInitialized();
    const mounts = this.activeMounts();
    if (mounts.every((mount) => mount.store.scoreVectors && mount.store.hydrateVectorHits)) {
      return this.searchVectorTwoPhase(mounts, request);
    }
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

  /**
   * Scores every pack first and hydrates only the global top window, so a search over hundreds of
   * small packs reads chunk rows for at most `window` hits instead of each pack's own top list.
   */
  private async searchVectorTwoPhase(
    mounts: readonly InternalMount[],
    request: VectorSearchRequest,
  ): Promise<readonly VectorHit[]> {
    const window = Math.min(500, Math.max(request.limit * 10, 100));
    const scored = await Promise.all(
      mounts.map(async (mount) => ({
        mount,
        scores: (await mount.store.scoreVectors?.({ ...request, limit: window })) ?? [],
      })),
    );
    const best = new Map<string, { mount: InternalMount; score: number }>();
    for (const { mount, scores } of scored) {
      for (const { chunkId, score } of scores) {
        const weighted = score * mount.searchWeight;
        const existing = best.get(chunkId);
        if (!existing || weighted > existing.score) best.set(chunkId, { mount, score: weighted });
      }
    }
    const chosen = [...best.entries()]
      .toSorted(
        ([leftId, left], [rightId, right]) =>
          right.score - left.score || compareText(leftId, rightId),
      )
      .slice(0, window);
    const byMount = new Map<InternalMount, { chunkId: string; score: number }[]>();
    for (const [chunkId, { mount, score }] of chosen) {
      byMount.set(mount, [...(byMount.get(mount) ?? []), { chunkId, score }]);
    }
    const hydrated = await Promise.all(
      [...byMount].map(
        async ([mount, scores]) =>
          (await mount.store.hydrateVectorHits?.(scores, request.filters)) ?? [],
      ),
    );
    return hydrated
      .flat()
      .toSorted(
        (left, right) => right.score - left.score || compareText(left.chunk.id, right.chunk.id),
      )
      .slice(0, request.limit);
  }

  public async close(): Promise<void> {
    this.documentOwners.clear();
    this.validatedAliases = undefined;
    this.aliasesPending = undefined;
    this.checkedAliases = undefined;
    const results = await Promise.allSettled(
      [...this.mounts.values()].map((mount) => mount.store.close()),
    );
    this.initialized = false;
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) throw new Error(`Unable to close ${failures.length} medical stores.`);
  }

  private documentOwner(id: string): MedicalStore | undefined {
    const owner = this.documentOwners.get(id);
    return owner && this.mounts.get(owner.moduleId) === owner ? owner.store : undefined;
  }

  private activeMounts(): readonly InternalMount[] {
    this.assertRequiredMountsEnabled();
    return [...this.mounts.values()]
      .filter((mount) => mount.enabled && !mount.definitionReference)
      .toSorted(
        (left, right) =>
          right.searchWeight - left.searchWeight || compareText(left.moduleId, right.moduleId),
      );
  }

  private async validateComposition(): Promise<readonly StorageHealth[]> {
    for (const mount of this.mounts.values()) {
      if (!mount.enabled || !mount.definitionReference) continue;
      if (mount.required || mount.acceptsSeed || !mount.store.reference)
        throw new Error('Invalid reference mount.');
      const reference = await mount.store.reference({
        op: 'status',
        moduleId: mount.moduleId,
        editionId: mount.definitionReference.editionId,
      });
      if (
        reference.op !== 'status' ||
        reference.editionId !== mount.definitionReference.editionId ||
        reference.entries !== mount.definitionReference.entries
      )
        throw new Error('Reference edition does not match the installed descriptor.');
    }
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

    const documentOwners = new Map<string, InternalMount>();
    const versionIds = new Set<string>();
    // The candidate core checks identifiers and aliases before it replaces the live core. With a
    // large library, give the foreground a chance to paint while building these private maps.
    const pause = createStorageTimeSlicer(4);
    let checkedRecords = 0;
    const mountDocuments = readValidationRecords(active, async (mount) => ({
      mount,
      documents: await (mount.store.listDocumentIdentities
        ? mount.store.listDocumentIdentities()
        : mount.store.listDocuments()),
    }));
    for await (const { mount, documents } of mountDocuments) {
      for (const document of documents) {
        const versionId = 'versionId' in document ? document.versionId : document.version.id;
        if (documentOwners.has(document.id))
          throw new Error(`Duplicate active document ID: ${document.id}`);
        if (versionIds.has(versionId)) {
          throw new Error(`Duplicate active document-version ID: ${versionId}`);
        }
        documentOwners.set(document.id, mount);
        versionIds.add(versionId);
        if (++checkedRecords % 128 === 0) {
          const due = pause();
          if (due) await due;
        }
      }
    }

    const aliases = new Map<string, AliasRecord>();
    const aliasInputs: (readonly AliasRecord[])[] = [];
    for await (const moduleAliases of readValidationRecords(active, (mount) =>
      mount.store.listAliases(),
    )) {
      aliasInputs.push(moduleAliases);
      for (const alias of moduleAliases) {
        const existing = aliases.get(alias.id);
        if (existing && aliasSignature(existing) !== aliasSignature(alias))
          throw new Error(`Conflicting alias ID: ${alias.id}`);
        aliases.set(alias.id, alias);
        if (++checkedRecords % 128 === 0) {
          const due = pause();
          if (due) await due;
        }
      }
    }

    const profiles = new Map<string, string>();
    for await (const moduleProfiles of readValidationRecords(active, (mount) =>
      mount.store.listEmbeddingProfiles(),
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
    // The aliases were checked for conflicts above. Their sorted list is made by `listAliases`
    // when the search first asks for it: the sort is the longest step with the drug packs mounted
    // and nothing on the way to a ready core needs it.
    this.validatedAliases = undefined;
    this.aliasesPending = undefined;
    this.checkedAliases = { inputs: aliasInputs, byId: aliases };
    this.documentOwners = documentOwners;
    return health;
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
