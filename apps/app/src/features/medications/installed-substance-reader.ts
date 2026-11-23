import { Capacitor } from '@capacitor/core';
import type { MedicalDocument, MedicalDocumentSummary } from '@localmed/contracts';
import {
  readInstalledModuleDocument,
  withInstalledReaderCore,
} from '@/composition/create-browser-core';
import {
  instructionIndexFromSummaries,
  instructionSourceClassIndexFromSummaries,
  isEsklpSubstanceDocument,
} from '@/features/medications/drug-screen';
import {
  instructionModuleIdForSubstanceModule,
  instructionReadabilityIndex,
} from '@/features/medications/instruction-source';
import {
  type MedicationProduct,
  parseEsklpMedicationProducts,
} from '@/features/medications/medication-record';
import { representativeInstructionProduct } from '@/features/medications/substance-reading';
import { prioritizeInstalledModuleRead } from '@/features/modules/browser-module-runtime';
import { loadModuleCatalog } from '@/features/modules/module-catalog-state';
import { installedModuleVersion } from '@/features/modules/module-pointer-install';
import {
  getContentModuleRuntime,
  peekContentModuleRuntime,
} from '@/features/modules/module-runtime-service';
import { readInstalledDataVersion } from '@/state/search-data-version';

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

/**
 * Extracts unique registration numbers directly from the ЕСКЛП `smnnNodes` trade list so the
 * companion instruction query can run without parsing every `klpPositions` packaging row twice.
 */
export function extractEsklpRegistrationNumbers(source: MedicalDocument): readonly string[] {
  if (!isEsklpSubstanceDocument(source)) return [];
  const nodes = source.metadata['smnnNodes'];
  if (!Array.isArray(nodes)) return [];
  const registrations = new Set<string>();
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) continue;
    const record = node as Readonly<Record<string, unknown>>;
    if (!nonEmptyString(record['smnnCode'])) continue;
    const nodeDosageForm = nonEmptyString(record['dosageForm']);
    const tradeNames = record['tradeNames'];
    if (!Array.isArray(tradeNames)) continue;
    for (const trade of tradeNames) {
      if (typeof trade !== 'object' || trade === null || Array.isArray(trade)) continue;
      const tradeRecord = trade as Readonly<Record<string, unknown>>;
      const tradeName = nonEmptyString(tradeRecord['tradeName']);
      const registrationNumber = nonEmptyString(tradeRecord['registrationNumber']);
      const dosageForm = nonEmptyString(tradeRecord['dosageForm']) ?? nodeDosageForm;
      if (tradeName && registrationNumber && dosageForm) registrations.add(registrationNumber);
    }
  }
  return [...registrations];
}

export function selectSubstanceInstruction(
  source: MedicalDocument,
  documents: readonly Pick<MedicalDocumentSummary, 'id' | 'sourceType' | 'metadata'>[],
  readability: ReadonlyMap<string, number> = instructionReadabilityIndex(documents),
): MedicationProduct | null {
  return representativeInstructionProduct(
    parseEsklpMedicationProducts(
      source,
      instructionIndexFromSummaries(documents),
      instructionSourceClassIndexFromSummaries(documents),
    ),
    typeof source.metadata['standardizedInn'] === 'string'
      ? source.metadata['standardizedInn']
      : source.title,
    readability,
  );
}

interface InstalledSubstanceRead {
  readonly source: MedicalDocument;
  readonly instruction: { readonly product: MedicationProduct; readonly document: MedicalDocument };
  readonly fromDisk?: true;
}

const READER_CACHE = 'minimed-last-installed-instruction-v1';

function cacheAddress(): string {
  return new URL('/__minimed/last-installed-instruction', window.location.origin).href;
}

async function readCachedInstruction(
  id: string,
  dataVersion: string,
): Promise<InstalledSubstanceRead | undefined> {
  if (typeof caches === 'undefined' || !dataVersion.startsWith('core:')) return undefined;
  const response = await (await caches.open(READER_CACHE)).match(cacheAddress());
  if (!response) return undefined;
  // This app-owned snapshot contains only documents already read from verified installed packs.
  const saved = (await response.json()) as
    | (Partial<InstalledSubstanceRead> & { dataVersion?: unknown })
    | null;
  if (saved?.dataVersion !== dataVersion) return undefined;
  const { source, instruction } = saved;
  const document = instruction?.document;
  const product = instruction?.product;
  if (
    source?.id !== id ||
    !source.metadata ||
    !isEsklpSubstanceDocument(source) ||
    !Array.isArray(source.sections) ||
    product?.mnnDocumentId !== id ||
    document?.id !== product.instructionDocumentId ||
    document?.sourceType !== 'official_drug_instruction' ||
    !document.sourceChecksum ||
    !document.metadata ||
    !Array.isArray(document.sections) ||
    !document.sections.every(
      (section) =>
        Array.isArray(section?.chunks) &&
        section.chunks.every(
          (chunk: { originalText?: unknown } | null) => typeof chunk?.originalText === 'string',
        ),
    )
  ) {
    return undefined;
  }
  performance.mark('minimed:reader:instruction-cache');
  return { source, instruction: { product, document }, fromDisk: true };
}

async function saveCachedInstruction(
  result: InstalledSubstanceRead,
  dataVersion: string,
): Promise<void> {
  if (typeof caches === 'undefined' || !dataVersion.startsWith('core:')) return;
  const { source, instruction } = result;
  // Keep a single public instruction and just enough substance metadata for its first paint.
  // The registration tree and all extra panels are still read from the installed packs.
  const header = {
    ...source,
    metadata: {
      contentMode: source.metadata['contentMode'],
      standardizedInn: source.metadata['standardizedInn'],
      inn: source.metadata['inn'],
    },
    sections: [],
  };
  const body = JSON.stringify({ dataVersion, source: header, instruction });
  if (body.length > 256_000) return;
  await (await caches.open(READER_CACHE)).put(cacheAddress(), new Response(body));
}

async function readSubstance(id: string): Promise<InstalledSubstanceRead | undefined> {
  const startedAt = performance.now();
  const runtime = peekContentModuleRuntime() ?? getContentModuleRuntime(await loadModuleCatalog());
  const catalog = runtime.getCatalog();
  const installed = runtime.listInstalled();
  const substanceModule = catalog.modules.find(
    (entry) =>
      instructionModuleIdForSubstanceModule(entry.id) &&
      entry.documents.some((document) => document.documentId === id),
  );
  if (!substanceModule || !installedModuleVersion(substanceModule, installed)) return undefined;
  const companionId = instructionModuleIdForSubstanceModule(substanceModule.id);
  const companion = catalog.modules.find((entry) => entry.id === companionId);
  if (!companion || !installedModuleVersion(companion, installed)) return undefined;

  performance.measure('minimed:reader:substance-locate', { start: startedAt });
  const sourceStartedAt = performance.now();
  // Project away unused ЕСКЛП fields in the worker before structured-cloning the substance header.
  const sourceRead = readInstalledModuleDocument(
    substanceModule,
    id,
    true,
    'medication-catalog',
  ).finally(() => {
    performance.measure('minimed:reader:substance-pack', { start: sourceStartedAt });
  });
  const instructionRead = withInstalledReaderCore(companion, async (core, store) => {
    // Open and initialize the companion instruction index while the substance header is being read.
    const initPromise = core.initialize();
    const [source, initialized] = await Promise.all([sourceRead, initPromise]);
    if (!source || !initialized.ok || !isEsklpSubstanceDocument(source)) return undefined;
    const listingsStartedAt = performance.now();
    const registrations = extractEsklpRegistrationNumbers(source);
    const listed = await (store.listInstructionDocuments?.(registrations) ??
      store.listNavigationDocuments?.() ??
      store.listDocuments());
    performance.measure('minimed:reader:instruction-lookup', { start: listingsStartedAt });
    const readability = instructionReadabilityIndex(listed);
    const product = selectSubstanceInstruction(source, listed, readability);
    const target = product?.instructionDocumentId;
    // A whole, native-text ГРЛС instruction for the matched registration can lead the card.
    // Scan, leaflet and fallback selections use the full set's usual ranking.
    if (
      !product ||
      !target ||
      product.instructionFallback ||
      (product.instructionSourceClass ?? 'grls') !== 'grls' ||
      readability.get(target) !== 0
    )
      return undefined;
    const textStartedAt = performance.now();
    const result = await core.getDocument(target);
    performance.measure('minimed:reader:instruction-read', { start: textStartedAt });
    return result.ok &&
      result.value.sourceType === 'official_drug_instruction' &&
      result.value.sections.some((section) => section.chunks.length > 0)
      ? { product, document: result.value }
      : undefined;
  });
  const [source, instruction] = await Promise.all([sourceRead, instructionRead]);
  return source && instruction ? { source, instruction } : undefined;
}

function guardedRead(id: string, dataVersion: string): Promise<InstalledSubstanceRead | undefined> {
  return prioritizeInstalledModuleRead(async () => {
    const cached = await readCachedInstruction(id, dataVersion).catch((error: unknown) => {
      console.warn('Unable to read the last installed instruction cache.', error);
      return undefined;
    });
    return cached ?? readSubstance(id);
  }).catch((error: unknown) => {
    console.warn('Unable to read a medication from its installed packs.', error);
    return undefined;
  });
}

let prepared:
  | {
      readonly id: string;
      readonly dataVersion: string;
      readonly read: Promise<InstalledSubstanceRead | undefined>;
    }
  | undefined;

export function prepareInstalledSubstanceReader(id: string): void {
  if (Capacitor.getPlatform() !== 'android' || !id.startsWith('esklp.mnn.') || prepared?.id === id)
    return;
  const dataVersion = readInstalledDataVersion();
  prepared = { id, dataVersion, read: guardedRead(id, dataVersion) };
}

export function readInstalledSubstance(
  id: string,
): Promise<InstalledSubstanceRead | undefined> | undefined {
  if (Capacitor.getPlatform() !== 'android' || !id.startsWith('esklp.mnn.')) return undefined;
  const dataVersion = readInstalledDataVersion();
  const pending = prepared?.id === id ? prepared : undefined;
  if (pending) prepared = undefined;
  const read = pending?.dataVersion === dataVersion ? pending.read : guardedRead(id, dataVersion);
  return read.then((result) => {
    // A speculative search result can warm the read, but only an opened card takes the disk slot.
    if (result && !result.fromDisk) {
      setTimeout(() => {
        void saveCachedInstruction(result, dataVersion).catch((error: unknown) => {
          console.warn('Unable to keep the last installed instruction.', error);
        });
      }, 250);
    }
    return result;
  });
}
