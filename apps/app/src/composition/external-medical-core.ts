import type { MedicalCore } from '@localmed/contracts';

export type ExternalMedicalCoreFactory = () => Promise<MedicalCore | null>;

let registeredFactory: ExternalMedicalCoreFactory | null = null;

function asDirectSearchCore(core: MedicalCore): MedicalCore {
  return {
    initialize: () => core.initialize(),
    async getCapabilities() {
      const result = await core.getCapabilities();
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          ...result.value,
          searchExecution: 'direct-only',
        },
      };
    },
    listDocuments: () => core.listDocuments(),
    analyzeQuery: (request) => core.analyzeQuery(request),
    search: (request) => core.search(request),
    getDocument: (documentId) => core.getDocument(documentId),
    getSection: (sectionId) => core.getSection(sectionId),
    getContext: (chunkId, radius) => core.getContext(chunkId, radius),
    getSearchResultContext: (result, radius) => core.getSearchResultContext(result, radius),
    ask: (request) => core.ask(request),
    installContentPack: (request) => core.installContentPack(request),
    close: () => core.close(),
  };
}

export function registerExternalMedicalCoreFactory(
  factory: ExternalMedicalCoreFactory,
): () => void {
  if (registeredFactory) {
    throw new Error('An external MedicalCore factory is already registered.');
  }
  registeredFactory = factory;
  return () => {
    if (registeredFactory === factory) registeredFactory = null;
  };
}

export function hasExternalMedicalCoreFactory(): boolean {
  return registeredFactory !== null;
}

export async function createRegisteredExternalMedicalCore(): Promise<MedicalCore | null> {
  if (!registeredFactory) return null;
  const core = await registeredFactory();
  return core ? asDirectSearchCore(core) : null;
}
