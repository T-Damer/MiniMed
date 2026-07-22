import bundledCatalog from './catalog.preview.json';
import type {
  LocalModelArtifact,
  LocalModelCatalog,
  LocalModelCatalogLoad,
  LocalModelDescriptor,
  LocalModelLicense,
  LocalModelPlatform,
  LocalModelRuntimeKind,
  LocalModelTier,
} from './types';

const CACHE_KEY = 'minimed.local-model-catalog.preview.v1';
const RUNTIMES = new Set<LocalModelRuntimeKind>([
  'wllama-web',
  'litert-native',
  'cactus-native',
]);
const PLATFORMS = new Set<LocalModelPlatform>(['browser', 'android', 'ios']);
const TIERS = new Set<LocalModelTier>(['compact', 'balanced', 'quality']);

interface CachedCatalog {
  readonly catalog: LocalModelCatalog;
  readonly storedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} должен быть непустой строкой.`);
  }
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} должен быть неотрицательным числом.`);
  }
  return value;
}

function parseLicense(value: unknown, modelId: string): LocalModelLicense {
  if (!isRecord(value)) throw new Error(`${modelId}: license должен быть объектом.`);
  return {
    id: requiredString(value['id'], `${modelId}.license.id`),
    name: requiredString(value['name'], `${modelId}.license.name`),
    url: requiredString(value['url'], `${modelId}.license.url`),
    requiresAcceptance: value['requiresAcceptance'] === true,
  };
}

function parseArtifact(value: unknown, modelId: string): LocalModelArtifact {
  if (!isRecord(value)) throw new Error(`${modelId}: artifact должен быть объектом.`);
  const runtime = requiredString(value['runtime'], `${modelId}.artifact.runtime`);
  if (!RUNTIMES.has(runtime as LocalModelRuntimeKind)) {
    throw new Error(`${modelId}: неизвестный runtime ${runtime}.`);
  }
  const rawPlatforms = value['platforms'];
  if (!Array.isArray(rawPlatforms) || rawPlatforms.length === 0) {
    throw new Error(`${modelId}: artifact.platforms должен быть непустым массивом.`);
  }
  const platforms = rawPlatforms.map((item) => {
    const platform = requiredString(item, `${modelId}.artifact.platform`);
    if (!PLATFORMS.has(platform as LocalModelPlatform)) {
      throw new Error(`${modelId}: неизвестная платформа ${platform}.`);
    }
    return platform as LocalModelPlatform;
  });
  const mirrorPath = value['mirrorPath'];
  const sha256 = value['sha256'];
  return {
    id: requiredString(value['id'], `${modelId}.artifact.id`),
    runtime: runtime as LocalModelRuntimeKind,
    platforms,
    upstreamUrl: requiredString(value['upstreamUrl'], `${modelId}.artifact.upstreamUrl`),
    mirrorPath:
      mirrorPath === null ? null : requiredString(mirrorPath, `${modelId}.artifact.mirrorPath`),
    downloadBytes: requiredNumber(value['downloadBytes'], `${modelId}.artifact.downloadBytes`),
    sha256: sha256 === null ? null : requiredString(sha256, `${modelId}.artifact.sha256`),
    published: value['published'] === true,
    maxContextTokens: requiredNumber(
      value['maxContextTokens'],
      `${modelId}.artifact.maxContextTokens`,
    ),
  };
}

function parseModel(value: unknown): LocalModelDescriptor {
  if (!isRecord(value)) throw new Error('Элемент models должен быть объектом.');
  const id = requiredString(value['id'], 'model.id');
  const tier = requiredString(value['tier'], `${id}.tier`);
  if (!TIERS.has(tier as LocalModelTier)) throw new Error(`${id}: неизвестный tier ${tier}.`);
  const rawArtifacts = value['artifacts'];
  if (!Array.isArray(rawArtifacts) || rawArtifacts.length === 0) {
    throw new Error(`${id}: artifacts должен быть непустым массивом.`);
  }
  const artifacts = rawArtifacts.map((artifact) => parseArtifact(artifact, id));
  if (new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length) {
    throw new Error(`${id}: повторяющийся artifact id.`);
  }
  return {
    id,
    name: requiredString(value['name'], `${id}.name`),
    family: requiredString(value['family'], `${id}.family`),
    tier: tier as LocalModelTier,
    description: requiredString(value['description'], `${id}.description`),
    parameterCount: requiredNumber(value['parameterCount'], `${id}.parameterCount`),
    qualityScore: requiredNumber(value['qualityScore'], `${id}.qualityScore`),
    russianPriority: requiredNumber(value['russianPriority'], `${id}.russianPriority`),
    minimumMemoryGb: requiredNumber(value['minimumMemoryGb'], `${id}.minimumMemoryGb`),
    recommendedMemoryGb: requiredNumber(
      value['recommendedMemoryGb'],
      `${id}.recommendedMemoryGb`,
    ),
    license: parseLicense(value['license'], id),
    artifacts,
  };
}

export function parseLocalModelCatalog(value: unknown): LocalModelCatalog {
  if (!isRecord(value)) throw new Error('Каталог моделей должен быть объектом.');
  if (value['schemaVersion'] !== 1) throw new Error('Неподдерживаемая схема каталога моделей.');
  const runtime = value['runtime'];
  if (!isRecord(runtime)) throw new Error('runtime должен быть объектом.');
  const rawModels = value['models'];
  if (!Array.isArray(rawModels) || rawModels.length === 0) {
    throw new Error('models должен быть непустым массивом.');
  }
  const models = rawModels.map(parseModel);
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    throw new Error('Каталог содержит повторяющиеся model id.');
  }
  return {
    schemaVersion: 1,
    catalogVersion: requiredString(value['catalogVersion'], 'catalogVersion'),
    publishedAt: requiredString(value['publishedAt'], 'publishedAt'),
    runtime: {
      wllamaModuleUrl: requiredString(runtime['wllamaModuleUrl'], 'runtime.wllamaModuleUrl'),
      wllamaWasmUrl: requiredString(runtime['wllamaWasmUrl'], 'runtime.wllamaWasmUrl'),
      version: requiredString(runtime['version'], 'runtime.version'),
    },
    models,
  };
}

function readCache(): LocalModelCatalog | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error('invalid cache record');
    return parseLocalModelCatalog(parsed['catalog']);
  } catch {
    window.localStorage.removeItem(CACHE_KEY);
    return null;
  }
}

function writeCache(catalog: LocalModelCatalog): void {
  const record: CachedCatalog = { catalog, storedAt: new Date().toISOString() };
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(record));
}

export async function loadLocalModelCatalog(remoteUrl: string): Promise<LocalModelCatalogLoad> {
  const bundled = parseLocalModelCatalog(bundledCatalog);
  if (remoteUrl.trim().length === 0) {
    return { catalog: bundled, source: 'bundled', warning: null };
  }
  try {
    const response = await fetch(remoteUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remote = parseLocalModelCatalog(await response.json());
    writeCache(remote);
    return { catalog: remote, source: 'remote', warning: null };
  } catch (cause) {
    const cached = readCache();
    const detail = cause instanceof Error ? cause.message : 'неизвестная ошибка';
    if (cached) {
      return {
        catalog: cached,
        source: 'cache',
        warning: `Каталог GitHub недоступен; используется проверенная копия: ${detail}`,
      };
    }
    return {
      catalog: bundled,
      source: 'bundled',
      warning: `Каталог GitHub недоступен; используется встроенный список: ${detail}`,
    };
  }
}
