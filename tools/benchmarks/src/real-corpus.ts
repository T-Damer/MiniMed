// The released corpus as the app mounts it: apps/app/public/content/core.db plus every companion
// pack present there, with the app's search weights. Benchmarks on it replace the former pilot
// and demo corpora; no benchmark depends on content that is not shipped to users.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createBunFileMedicalStore } from '@localmed/benchmarks/bun-sqlite-medical-store';
import type { MedicalCore, MedicalDocumentSummary } from '@localmed/contracts';
import { createMedicalCore } from '@localmed/core';
import type { QueryEmbedder } from '@localmed/search-semantic';
import { MultiMedicalStore } from '@localmed/storage';

export const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../..');
const CONTENT = resolve(REPOSITORY_ROOT, 'apps/app/public/content');
// Mirrors builtInCompanionMounts in apps/app/src/composition/create-browser-core.ts.
const COMPANIONS = [
  ['mkb.db', 1.05],
  ['medications.db', 1.15],
  ['ambulatory.db', 1.05],
  ['regulatory.db', 1.12],
  ['reference.db', 1.08],
] as const;

export interface RealCorpus {
  readonly core: MedicalCore;
  /** The databases mounted, core first; companions that are not present locally are skipped. */
  readonly corpus: readonly string[];
  readonly documents: ReadonlyMap<string, MedicalDocumentSummary>;
  /** A catalog pointer stands for the document it points to (`kr.rf.714_2`). */
  readonly target: (documentId: string) => string;
  /**
   * The underlying multi-pack store `core` was built from. Not needed for ordinary quality/latency
   * benchmarks — native oracle exporters observe its actual branch calls and aliases without
   * reimplementing the production query pipeline.
   */
  readonly store: MultiMedicalStore;
}

export async function openRealCorpus(
  options: {
    readonly embedder?: QueryEmbedder;
    /** `false` mounts core.db alone, as CI has it after content:restore:core. */
    readonly companions?: boolean;
    /**
     * Mount a candidate core.db from elsewhere instead of the released
     * apps/app/public/content/core.db -- e.g. a rebuild candidate under data/build/, to compare
     * against the released corpus without touching the released file. Companion packs still
     * come from apps/app/public/content (this only substitutes core.db itself).
     */
    readonly corePath?: string | undefined;
    /** Explicit verified installed artifacts, mounted before the core builds its vocabulary. */
    readonly installedModules?: readonly {
      readonly moduleId: string;
      readonly path: string;
    }[];
  } = {},
): Promise<RealCorpus> {
  const corePath = options.corePath ? resolve(options.corePath) : resolve(CONTENT, 'core.db');
  if (!existsSync(corePath)) throw new Error(`Missing ${corePath}; run content:restore:core.`);
  const companions =
    options.companions === false
      ? []
      : COMPANIONS.filter(([file]) => existsSync(resolve(CONTENT, file)));
  const store = new MultiMedicalStore([
    {
      moduleId: 'minimed.core.ru',
      store: await createBunFileMedicalStore(corePath),
      required: true,
      searchWeight: 1.1,
    },
    ...(await Promise.all(
      companions.map(async ([file, searchWeight]) => ({
        moduleId: file,
        store: await createBunFileMedicalStore(resolve(CONTENT, file)),
        required: true,
        searchWeight,
      })),
    )),
    ...(await Promise.all(
      (options.installedModules ?? []).map(async ({ moduleId, path }) => ({
        moduleId,
        store: await createBunFileMedicalStore(resolve(path)),
        required: true,
        searchWeight: 1,
      })),
    )),
  ]);
  const core = createMedicalCore({
    store,
    platform: 'test',
    ...(options.embedder ? { embedder: options.embedder } : {}),
  });
  const initialized = await core.initialize();
  if (!initialized.ok) throw new Error(initialized.error.message);
  const listed = await core.listDocuments();
  if (!listed.ok) throw new Error(listed.error.message);
  const documents = new Map(listed.value.map((document) => [document.id, document]));
  return {
    core,
    corpus: [
      'core.db',
      ...companions.map(([file]) => file),
      ...(options.installedModules ?? []).map(({ moduleId }) => moduleId),
    ],
    documents,
    store,
    target: (documentId) => {
      const pointed = documents.get(documentId)?.metadata?.['targetDocumentId'];
      return typeof pointed === 'string' ? pointed : documentId;
    },
  };
}
