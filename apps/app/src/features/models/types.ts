export type LocalModelPlatform = 'browser' | 'android' | 'ios';
export type LocalModelRuntimeKind = 'wllama-web' | 'litert-native' | 'cactus-native';
export type LocalModelTier = 'compact' | 'balanced' | 'quality';
export type LocalModelPhase =
  | 'idle'
  | 'probing'
  | 'selecting'
  | 'deferred'
  | 'downloading'
  | 'loading'
  | 'benchmarking'
  | 'ready'
  | 'error';
export type LocalModelStructuredTaskKind = 'query-plan' | 'rerank';

export interface LocalModelLicense {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly requiresAcceptance: boolean;
}

export interface LocalModelArtifact {
  readonly id: string;
  readonly runtime: LocalModelRuntimeKind;
  readonly platforms: readonly LocalModelPlatform[];
  readonly upstreamUrl: string;
  readonly mirrorPath: string | null;
  readonly downloadBytes: number;
  readonly sha256: string | null;
  readonly published: boolean;
  readonly maxContextTokens: number;
}

export interface LocalModelDescriptor {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly tier: LocalModelTier;
  readonly description: string;
  readonly parameterCount: number;
  readonly qualityScore: number;
  readonly russianPriority: number;
  readonly minimumMemoryGb: number;
  readonly recommendedMemoryGb: number;
  readonly license: LocalModelLicense;
  readonly artifacts: readonly LocalModelArtifact[];
}

export interface LocalModelCatalogRuntime {
  readonly wllamaModuleUrl: string;
  readonly wllamaWasmUrl: string;
  readonly version: string;
}

export interface LocalModelCatalog {
  readonly schemaVersion: 1;
  readonly catalogVersion: string;
  readonly publishedAt: string;
  readonly runtime: LocalModelCatalogRuntime;
  readonly models: readonly LocalModelDescriptor[];
}

export interface LocalModelCatalogLoad {
  readonly catalog: LocalModelCatalog;
  readonly source: 'remote' | 'cache' | 'bundled';
  readonly warning: string | null;
}

export interface LocalModelDeviceProfile {
  readonly platform: LocalModelPlatform;
  readonly nativeContainer: boolean;
  readonly deviceMemoryGb: number | null;
  readonly hardwareConcurrency: number;
  readonly freeStorageBytes: number | null;
  readonly webgpu: boolean;
  readonly saveData: boolean;
  readonly effectiveConnectionType: string | null;
  readonly automation: boolean;
  readonly cpuProbeScore: number;
  readonly fingerprint: string;
}

export interface LocalModelBenchmark {
  readonly modelId: string;
  readonly artifactId: string;
  readonly runtime: LocalModelRuntimeKind;
  readonly measuredAt: string;
  readonly loadMs: number;
  readonly generationMs: number;
  readonly outputCharacters: number;
  readonly validStructuredOutput: boolean;
  readonly deviceFingerprint: string;
}

export interface LocalModelPreference {
  readonly automatic: boolean;
  readonly selectedModelId: string | null;
  readonly acceptedLicenseIds: readonly string[];
  readonly autoLoad: boolean;
}

export interface LocalModelSelection {
  readonly model: LocalModelDescriptor;
  readonly artifact: LocalModelArtifact;
  readonly score: number;
  readonly reasons: readonly string[];
}

export interface LocalModelState {
  readonly phase: LocalModelPhase;
  readonly message: string;
  readonly progress: number | null;
  readonly catalogSource: LocalModelCatalogLoad['source'] | null;
  readonly recommendedModelId: string | null;
  readonly selectedModelId: string | null;
  readonly activeModelId: string | null;
  readonly benchmark: LocalModelBenchmark | null;
  readonly device: LocalModelDeviceProfile | null;
  readonly error: string | null;
}

export interface LocalModelLoadCallbacks {
  readonly onProgress: (loaded: number, total: number) => void;
}

export interface LocalModelStructuredRequest {
  readonly task: LocalModelStructuredTaskKind;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly maxTokens: number;
  readonly temperature?: number;
}

export interface LocalModelStructuredResponse {
  readonly task: LocalModelStructuredTaskKind;
  readonly rawText: string;
  readonly parsedJson: unknown | null;
  readonly generationMs: number;
}

export interface LocalModelSession {
  readonly modelId: string;
  readonly artifactId: string;
  benchmark(): Promise<Omit<LocalModelBenchmark, 'loadMs' | 'measuredAt' | 'deviceFingerprint'>>;
  completeStructured(
    request: LocalModelStructuredRequest,
  ): Promise<LocalModelStructuredResponse>;
  unload(): Promise<void>;
}

export interface LocalModelRuntime {
  readonly kind: LocalModelRuntimeKind;
  isAvailable(profile: LocalModelDeviceProfile): Promise<boolean>;
  load(
    model: LocalModelDescriptor,
    artifact: LocalModelArtifact,
    profile: LocalModelDeviceProfile,
    callbacks: LocalModelLoadCallbacks,
  ): Promise<LocalModelSession>;
}
