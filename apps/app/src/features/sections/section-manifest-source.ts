import type { ContentModuleCatalog, ContentModuleCatalogEntry } from '@localmed/contracts';
import { z } from 'zod';

/**
 * Derivation of the section manifest: which drug packages every clinical section needs. Pure and
 * shared by `scripts/build-section-manifest.ts` (which reads the files) and its tests. Nothing is
 * listed by hand: a section is a clinical module collection of the catalog, and its drugs are the
 * ЕСКЛП МНН that the section's recommendations name in `data/build/clinical-medication-relations`.
 */

/** The clinical collections the knowledge base already groups its recommendations into. */
export const CLINICAL_COLLECTION_PATTERN = /^minimed\.clinical\.[a-z0-9-]+\.ru$/u;

/** A drug group is one ATC level-1 group: its ЕСКЛП module and its ГРЛС instruction module. */
const ESKLP_MODULE_PATTERN = /^minimed\.medications\.([a-z0-9-]+)\.ru$/u;
const INSTRUCTION_MODULE_PREFIX = 'minimed.medications.instructions.';

export const SECTION_MANIFEST_SCHEMA_VERSION = 1;

/** The parts of one `clinical-medication-relations/<КР id>.json` file the derivation reads. */
export const ClinicalMedicationRelationsSchema = z.object({
  entities: z.array(
    z.object({
      id: z.string().min(1),
      entityType: z.string().min(1),
      externalIds: z.record(z.string(), z.string()).default({}),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }),
  ),
  relations: z.array(
    z.object({ subjectEntityId: z.string().min(1), objectEntityId: z.string().min(1) }),
  ),
});

export interface ClinicalRelationsFile {
  readonly fileName: string;
  /** SHA-256 of the file bytes, hex. */
  readonly sha256: string;
  readonly content: z.infer<typeof ClinicalMedicationRelationsSchema>;
}

export const SectionManifestSchema = z.object({
  schemaVersion: z.literal(SECTION_MANIFEST_SCHEMA_VERSION),
  provenance: z.object({
    catalogFile: z.string().min(1),
    catalogVersion: z.string().min(1),
    catalogSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    relationsDirectory: z.string().min(1),
    relationsFileCount: z.number().int().positive(),
    relationsDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    generator: z.string().min(1),
  }),
  drugGroups: z.array(
    z.object({
      id: z.string().min(1),
      esklpModuleId: z.string().min(1),
      instructionModuleId: z.string().min(1).nullable(),
    }),
  ),
  sections: z.array(
    z.object({
      collection: z.string().regex(CLINICAL_COLLECTION_PATTERN),
      /** Recommendations of the section that have a relations file. */
      relatedRecommendations: z.number().int().nonnegative(),
      /** Of those, the ones that name at least one drug. */
      recommendationsWithDrugs: z.number().int().nonnegative(),
      /** Distinct ЕСКЛП МНН the section's recommendations name. */
      medicationCount: z.number().int().nonnegative(),
      /** МНН that no ЕСКЛП module of the catalog lists; they need no package. */
      unmatchedMedicationCount: z.number().int().nonnegative(),
      drugs: z.array(
        z.object({
          groupId: z.string().min(1),
          medicationCount: z.number().int().positive(),
        }),
      ),
    }),
  ),
});

export type SectionManifest = z.infer<typeof SectionManifestSchema>;

export interface SectionManifestInput {
  readonly catalog: ContentModuleCatalog;
  readonly relations: readonly ClinicalRelationsFile[];
  readonly catalogFile: string;
  readonly catalogSha256: string;
  readonly relationsDirectory: string;
  readonly relationsDigest: string;
  readonly generator: string;
}

function isClinicalSectionModule(module: ContentModuleCatalogEntry): boolean {
  return (
    module.kind === 'clinical' &&
    module.releaseState !== 'planned' &&
    CLINICAL_COLLECTION_PATTERN.test(module.collection)
  );
}

/** ЕСКЛП МНН document id → the id of the ATC group its module belongs to. */
function medicationGroups(catalog: ContentModuleCatalog): {
  readonly groupOfMnn: ReadonlyMap<string, string>;
  readonly groups: SectionManifest['drugGroups'];
} {
  const moduleById = new Map(catalog.modules.map((module) => [module.id, module]));
  const groupOfMnn = new Map<string, string>();
  const groups: { id: string; esklpModuleId: string; instructionModuleId: string | null }[] = [];
  for (const module of catalog.modules) {
    if (module.kind !== 'medication' || module.collection !== 'esklp') continue;
    const id = ESKLP_MODULE_PATTERN.exec(module.id)?.[1];
    if (!id) continue;
    for (const document of module.documents) {
      const previous = groupOfMnn.get(document.documentId);
      if (previous !== undefined && previous !== id) {
        throw new Error(`${document.documentId} is listed by two ЕСКЛП groups: ${previous}, ${id}`);
      }
      groupOfMnn.set(document.documentId, id);
    }
    const instruction = moduleById.get(`${INSTRUCTION_MODULE_PREFIX}${id}.ru`);
    groups.push({
      id,
      esklpModuleId: module.id,
      instructionModuleId: instruction?.collection === 'grls-instructions' ? instruction.id : null,
    });
  }
  return { groupOfMnn, groups: groups.sort((a, b) => a.id.localeCompare(b.id)) };
}

/** The ЕСКЛП МНН ids a relations file connects to its recommendation, and that recommendation. */
function namedMedications(file: ClinicalRelationsFile): {
  readonly recommendationId: string;
  readonly mnnIds: ReadonlySet<string>;
} {
  const { entities, relations } = file.content;
  const conditions = entities.filter((entity) => entity.entityType === 'condition');
  const recommendationId = conditions[0]?.metadata['sourceDocumentId'];
  if (conditions.length !== 1 || typeof recommendationId !== 'string') {
    throw new Error(`${file.fileName}: expected one condition with a sourceDocumentId`);
  }
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const mnnIds = new Set<string>();
  for (const relation of relations) {
    for (const entityId of [relation.subjectEntityId, relation.objectEntityId]) {
      const entity = byId.get(entityId);
      const mnnId =
        entity?.entityType === 'medication' ? entity.externalIds['esklpMnnDocumentId'] : '';
      if (mnnId) mnnIds.add(mnnId);
    }
  }
  return { recommendationId, mnnIds };
}

/** Builds the manifest. A relations file whose recommendation is not in the catalog is an error. */
export function deriveSectionManifest(input: SectionManifestInput): SectionManifest {
  const { catalog } = input;
  const collectionOfDocument = new Map<string, string>();
  const collections = new Set<string>();
  for (const module of catalog.modules.filter(isClinicalSectionModule)) {
    collections.add(module.collection);
    for (const document of module.documents) {
      collectionOfDocument.set(document.documentId, module.collection);
    }
  }
  const { groupOfMnn, groups } = medicationGroups(catalog);

  interface Accumulator {
    related: number;
    withDrugs: number;
    mnn: Set<string>;
    unmatched: Set<string>;
  }
  const bySection = new Map<string, Accumulator>(
    [...collections].map((collection) => [
      collection,
      { related: 0, withDrugs: 0, mnn: new Set(), unmatched: new Set() },
    ]),
  );
  for (const file of input.relations) {
    const { recommendationId, mnnIds } = namedMedications(file);
    const collection = collectionOfDocument.get(recommendationId);
    const section = collection ? bySection.get(collection) : undefined;
    if (!section) {
      throw new Error(
        `${file.fileName}: ${recommendationId} is in no clinical module of the catalog`,
      );
    }
    section.related += 1;
    if (mnnIds.size > 0) section.withDrugs += 1;
    for (const mnnId of mnnIds) {
      (groupOfMnn.has(mnnId) ? section.mnn : section.unmatched).add(mnnId);
    }
  }

  const sections = [...bySection]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([collection, section]) => {
      const perGroup = new Map<string, number>();
      for (const mnnId of section.mnn) {
        const groupId = groupOfMnn.get(mnnId) as string;
        perGroup.set(groupId, (perGroup.get(groupId) ?? 0) + 1);
      }
      return {
        collection,
        relatedRecommendations: section.related,
        recommendationsWithDrugs: section.withDrugs,
        medicationCount: section.mnn.size,
        unmatchedMedicationCount: section.unmatched.size,
        drugs: [...perGroup]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([groupId, medicationCount]) => ({ groupId, medicationCount })),
      };
    });

  return {
    schemaVersion: SECTION_MANIFEST_SCHEMA_VERSION,
    provenance: {
      catalogFile: input.catalogFile,
      catalogVersion: catalog.catalogVersion,
      catalogSha256: input.catalogSha256,
      relationsDirectory: input.relationsDirectory,
      relationsFileCount: input.relations.length,
      relationsDigest: input.relationsDigest,
      generator: input.generator,
    },
    drugGroups: groups,
    sections,
  };
}
