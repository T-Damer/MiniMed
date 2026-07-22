import { BrowserWllamaRuntime } from './browser-runtime';
import { loadLocalModelCatalog } from './catalog';
import { rankLocalModels, selectLocalModel } from './selection';
import type {
  LocalModelBenchmark,
  LocalModelCatalog,
  LocalModelDescriptor,
  LocalModelDeviceProfile,
  LocalModelPreference,
  LocalModelRuntime,
  LocalModelRuntimeKind,
  LocalModelSelection,
  LocalModelSession,
  LocalModelState,
} from './types';

const PREFERENCE_KEY = 'minimed.local-model-preference.v1';
const BENCHMARK_KEY = 'minimed.local-model-benchmarks.v1';
const FAILURE_KEY = 'minimed.local-model-failures.v1';
const BENCHMARK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FAILURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface NavigatorConnection {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

interface NavigatorGpu {
  requestAdapter(): Promise<unknown | null>;
}

interface NavigatorCapabilities extends Navigator {
  readonly deviceMemory?: number;
  readonly connection?: NavigatorConnection;
  readonly gpu?: NavigatorGpu;
}

interface CapacitorBridge {
  isNativePlatform?(): boolean;
  getPlatform?(): string;
}

interface WindowWithCapacitor extends Window {
  readonly Capacitor?: CapacitorBridge;
}

interface BenchmarkStore {
  readonly records: readonly LocalModelBenchmark[];
}

interface FailureRecord {
  readonly modelId: string;
  readonly failedAt: string;
  readonly reason: string;
}

interface FailureStore {
  readonly records: readonly FailureRecord[];
}

export interface LocalModelControllerOptions {
  readonly remoteCatalogUrl: string;
  readonly mirrorBaseUrl: string;
  readonly allowUpstreamFallback: boolean;
  readonly enableWebgpu: boolean;
  readonly defaultAutoLoad: boolean;
}

export type LocalModelStateListener = (state: LocalModelState) => void;

const INITIAL_STATE: LocalModelState = {
  phase: 'idle',
  message: 'Локальная модель не запускалась.',
  progress: null,
  catalogSource: null,
  recommendedModelId: null,
  selectedModelId: null,
  activeModelId: null,
  benchmark: null,
  device: null,
  error: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultPreference(defaultAutoLoad: boolean): LocalModelPreference {
  return {
    automatic: true,
    selectedModelId: null,
    acceptedLicenseIds: [],
    autoLoad: defaultAutoLoad,
  };
}

function loadPreference(defaultAutoLoad: boolean): LocalModelPreference {
  try {
    const raw = window.localStorage.getItem(PREFERENCE_KEY);
    if (!raw) return defaultPreference(defaultAutoLoad);
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return defaultPreference(defaultAutoLoad);
    const accepted = Array.isArray(value['acceptedLicenseIds'])
      ? value['acceptedLicenseIds'].filter((item): item is string => typeof item === 'string')
      : [];
    return {
      automatic: value['automatic'] !== false,
      selectedModelId:
        typeof value['selectedModelId'] === 'string' ? value['selectedModelId'] : null,
      acceptedLicenseIds: accepted,
      autoLoad: typeof value['autoLoad'] === 'boolean' ? value['autoLoad'] : defaultAutoLoad,
    };
  } catch {
    return defaultPreference(defaultAutoLoad);
  }
}

function savePreference(preference: LocalModelPreference): void {
  window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify(preference));
}

function readBenchmarks(): readonly LocalModelBenchmark[] {
  try {
    const raw = window.localStorage.getItem(BENCHMARK_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !Array.isArray(value['records'])) return [];
    return value['records'].filter((item): item is LocalModelBenchmark => {
      if (!isRecord(item)) return false;
      return (
        typeof item['modelId'] === 'string' &&
        typeof item['artifactId'] === 'string' &&
        typeof item['runtime'] === 'string' &&
        typeof item['measuredAt'] === 'string' &&
        typeof item['loadMs'] === 'number' &&
        typeof item['generationMs'] === 'number' &&
        typeof item['outputCharacters'] === 'number' &&
        typeof item['validStructuredOutput'] === 'boolean' &&
        typeof item['deviceFingerprint'] === 'string'
      );
    });
  } catch {
    return [];
  }
}

function saveBenchmark(benchmark: LocalModelBenchmark): void {
  const records = readBenchmarks().filter(
    (item) =>
      !(
        item.modelId === benchmark.modelId &&
        item.artifactId === benchmark.artifactId &&
        item.deviceFingerprint === benchmark.deviceFingerprint
      ),
  );
  const store: BenchmarkStore = { records: [benchmark, ...records].slice(0, 24) };
  window.localStorage.setItem(BENCHMARK_KEY, JSON.stringify(store));
}

function cachedBenchmark(
  modelId: string,
  artifactId: string,
  fingerprint: string,
): LocalModelBenchmark | null {
  const now = Date.now();
  return (
    readBenchmarks().find((item) => {
      const measured = Date.parse(item.measuredAt);
      return (
        item.modelId === modelId &&
        item.artifactId === artifactId &&
        item.deviceFingerprint === fingerprint &&
        Number.isFinite(measured) &&
        now - measured <= BENCHMARK_MAX_AGE_MS
      );
    }) ?? null
  );
}

function readFailures(): readonly FailureRecord[] {
  try {
    const raw = window.localStorage.getItem(FAILURE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !Array.isArray(value['records'])) return [];
    return value['records'].filter((item): item is FailureRecord => {
      return (
        isRecord(item) &&
        typeof item['modelId'] === 'string' &&
        typeof item['failedAt'] === 'string' &&
        typeof item['reason'] === 'string'
      );
    });
  } catch {
    return [];
  }
}

function activeFailures(): ReadonlySet<string> {
  const now = Date.now();
  return new Set(
    readFailures()
      .filter((item) => {
        const failedAt = Date.parse(item.failedAt);
        return Number.isFinite(failedAt) && now - failedAt <= FAILURE_MAX_AGE_MS;
      })
      .map((item) => item.modelId),
  );
}

function recordFailure(modelId: string, reason: string): void {
  const records = readFailures().filter((item) => item.modelId !== modelId);
  const store: FailureStore = {
    records: [{ modelId, failedAt: new Date().toISOString(), reason }, ...records].slice(0, 12),
  };
  window.localStorage.setItem(FAILURE_KEY, JSON.stringify(store));
}

function clearFailure(modelId: string): void {
  const store: FailureStore = {
    records: readFailures().filter((item) => item.modelId !== modelId),
  };
  window.localStorage.setItem(FAILURE_KEY, JSON.stringify(store));
}

function cpuProbe(): number {
  const iterations = 160_000;
  let value = 0x12345678;
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    value = Math.imul(value ^ index, 2654435761) >>> 0;
  }
  const elapsed = Math.max(1, performance.now() - startedAt);
  if (value === Number.MIN_SAFE_INTEGER) console.debug(value);
  return Math.round(iterations / elapsed);
}

async function hasWebGpu(navigatorValue: NavigatorCapabilities): Promise<boolean> {
  if (!navigatorValue.gpu) return false;
  try {
    const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1500));
    const adapter = await Promise.race([navigatorValue.gpu.requestAdapter(), timeout]);
    return adapter !== null;
  } catch {
    return false;
  }
}

export async function probeLocalModelDevice(): Promise<LocalModelDeviceProfile> {
  const navigatorValue = navigator as NavigatorCapabilities;
  const capacitor = (window as WindowWithCapacitor).Capacitor;
  const nativeContainer = capacitor?.isNativePlatform?.() === true;
  const capacitorPlatform = capacitor?.getPlatform?.();
  const android = capacitorPlatform === 'android' || /android/u.test(navigator.userAgent.toLowerCase());
  const platform = android ? 'android' : 'browser';
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  const freeStorageBytes =
    typeof estimate?.quota === 'number' && typeof estimate.usage === 'number'
      ? Math.max(0, estimate.quota - estimate.usage)
      : null;
  const deviceMemoryGb =
    typeof navigatorValue.deviceMemory === 'number' && navigatorValue.deviceMemory > 0
      ? navigatorValue.deviceMemory
      : null;
  const hardwareConcurrency = Math.max(1, navigator.hardwareConcurrency || 1);
  const webgpu = await hasWebGpu(navigatorValue);
  const saveData = navigatorValue.connection?.saveData === true;
  const effectiveConnectionType = navigatorValue.connection?.effectiveType ?? null;
  const score = cpuProbe();
  const fingerprint = [
    platform,
    nativeContainer ? 'native' : 'web',
    deviceMemoryGb ?? 'unknown-memory',
    hardwareConcurrency,
    webgpu ? 'webgpu' : 'cpu',
    score,
  ].join(':');
  return {
    platform,
    nativeContainer,
    deviceMemoryGb,
    hardwareConcurrency,
    freeStorageBytes,
    webgpu,
    saveData,
    effectiveConnectionType,
    automation: navigator.webdriver === true,
    cpuProbeScore: score,
    fingerprint,
  };
}

export class LocalModelController {
  private readonly listeners = new Set<LocalModelStateListener>();
  private state: LocalModelState = INITIAL_STATE;
  private catalog: LocalModelCatalog | null = null;
  private preference: LocalModelPreference;
  private session: LocalModelSession | null = null;
  private runGeneration = 0;

  public constructor(private readonly options: LocalModelControllerOptions) {
    this.preference = loadPreference(options.defaultAutoLoad);
  }

  public getState(): LocalModelState {
    return this.state;
  }

  public getCatalog(): LocalModelCatalog | null {
    return this.catalog;
  }

  public getPreference(): LocalModelPreference {
    return this.preference;
  }

  public subscribe(listener: LocalModelStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<LocalModelState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  private runtimes(catalog: LocalModelCatalog): readonly LocalModelRuntime[] {
    return [
      new BrowserWllamaRuntime({
        moduleUrl: catalog.runtime.wllamaModuleUrl,
        wasmUrl: catalog.runtime.wllamaWasmUrl,
        mirrorBaseUrl: this.options.mirrorBaseUrl,
        allowUpstreamFallback: this.options.allowUpstreamFallback,
        enableWebgpu: this.options.enableWebgpu,
      }),
    ];
  }

  private async availableRuntimes(
    runtimes: readonly LocalModelRuntime[],
    profile: LocalModelDeviceProfile,
  ): Promise<ReadonlySet<LocalModelRuntimeKind>> {
    const entries = await Promise.all(
      runtimes.map(async (runtime) => [runtime.kind, await runtime.isAvailable(profile)] as const),
    );
    return new Set(entries.filter((entry) => entry[1]).map((entry) => entry[0]));
  }

  public async start(): Promise<void> {
    const generation = ++this.runGeneration;
    await this.session?.unload().catch(() => undefined);
    this.session = null;
    this.update({
      phase: 'probing',
      message: 'Проверяем память, хранилище и локальные AI-runtime…',
      progress: null,
      activeModelId: null,
      benchmark: null,
      error: null,
    });
    const [catalogLoad, profile] = await Promise.all([
      loadLocalModelCatalog(this.options.remoteCatalogUrl),
      probeLocalModelDevice(),
    ]);
    if (generation !== this.runGeneration) return;
    this.catalog = catalogLoad.catalog;
    const runtimes = this.runtimes(catalogLoad.catalog);
    const availableRuntimes = await this.availableRuntimes(runtimes, profile);
    if (generation !== this.runGeneration) return;
    const selectionInput = {
      models: catalogLoad.catalog.models,
      profile,
      preference: this.preference,
      availableRuntimes,
      failedModelIds: activeFailures(),
    } as const;
    const recommended = selectLocalModel(selectionInput);
    this.update({
      phase: 'selecting',
      message: recommended
        ? `Для устройства выбрана ${recommended.model.name}.`
        : 'Подходящая локальная модель не найдена; поиск продолжает работать без неё.',
      catalogSource: catalogLoad.source,
      recommendedModelId: recommended?.model.id ?? null,
      selectedModelId: recommended?.model.id ?? null,
      device: profile,
      error: catalogLoad.warning,
    });
    if (!recommended) return;
    if (!this.preference.autoLoad || profile.automation) {
      this.update({
        phase: 'deferred',
        message: profile.automation
          ? `Автозагрузка ${recommended.model.name} отключена в автоматизированном тесте.`
          : `${recommended.model.name} рекомендована; автозагрузка отключена в настройках.`,
      });
      return;
    }
    if (profile.saveData || profile.effectiveConnectionType?.includes('2g')) {
      this.update({
        phase: 'deferred',
        message: `${recommended.model.name} выбрана, но загрузка отложена из-за режима экономии трафика.`,
      });
      return;
    }
    const ranked = rankLocalModels(selectionInput);
    await this.loadFirstWorking(ranked.slice(0, 2), runtimes, profile, generation);
  }

  private async loadFirstWorking(
    candidates: readonly LocalModelSelection[],
    runtimes: readonly LocalModelRuntime[],
    profile: LocalModelDeviceProfile,
    generation: number,
  ): Promise<void> {
    let finalError: string | null = null;
    for (const candidate of candidates) {
      if (generation !== this.runGeneration) return;
      const runtime = runtimes.find((item) => item.kind === candidate.artifact.runtime);
      if (!runtime) continue;
      const loadStartedAt = performance.now();
      this.update({
        phase: 'downloading',
        message: `Загружаем ${candidate.model.name}…`,
        progress: 0,
        selectedModelId: candidate.model.id,
        error: null,
      });
      try {
        const session = await runtime.load(candidate.model, candidate.artifact, profile, {
          onProgress: (loaded, total) => {
            if (generation !== this.runGeneration) return;
            this.update({
              phase: loaded >= total && total > 0 ? 'loading' : 'downloading',
              message:
                loaded >= total && total > 0
                  ? `Запускаем ${candidate.model.name}…`
                  : `Загружаем ${candidate.model.name}…`,
              progress: total > 0 ? Math.max(0, Math.min(1, loaded / total)) : null,
            });
          },
        });
        if (generation !== this.runGeneration) {
          await session.unload();
          return;
        }
        const loadMs = performance.now() - loadStartedAt;
        const cached = cachedBenchmark(candidate.model.id, candidate.artifact.id, profile.fingerprint);
        let benchmark: LocalModelBenchmark;
        if (cached?.validStructuredOutput) {
          benchmark = { ...cached, loadMs };
        } else {
          this.update({
            phase: 'benchmarking',
            message: `Проверяем ${candidate.model.name} на коротком русском запросе…`,
            progress: null,
          });
          const measured = await session.benchmark();
          benchmark = {
            ...measured,
            loadMs,
            measuredAt: new Date().toISOString(),
            deviceFingerprint: profile.fingerprint,
          };
          saveBenchmark(benchmark);
        }
        if (!benchmark.validStructuredOutput) {
          await session.unload();
          recordFailure(candidate.model.id, 'Модель не вернула валидный структурированный ответ.');
          finalError = `${candidate.model.name} не прошла структурный тест.`;
          continue;
        }
        clearFailure(candidate.model.id);
        this.session = session;
        this.update({
          phase: 'ready',
          message: `${candidate.model.name} готова и работает локально.`,
          progress: 1,
          activeModelId: candidate.model.id,
          selectedModelId: candidate.model.id,
          benchmark,
          error: null,
        });
        return;
      } catch (cause) {
        finalError = cause instanceof Error ? cause.message : `Не удалось загрузить ${candidate.model.name}.`;
        recordFailure(candidate.model.id, finalError);
      }
    }
    this.update({
      phase: 'error',
      message: 'Локальная модель не запущена; SQLite-поиск остаётся доступным.',
      progress: null,
      activeModelId: null,
      error: finalError,
    });
  }

  private updatePreference(next: LocalModelPreference): void {
    this.preference = next;
    savePreference(next);
  }

  public async useAutomaticSelection(): Promise<void> {
    this.updatePreference({ ...this.preference, automatic: true, selectedModelId: null });
    await this.start();
  }

  public async selectModel(modelId: string): Promise<void> {
    this.updatePreference({ ...this.preference, automatic: false, selectedModelId: modelId });
    clearFailure(modelId);
    await this.start();
  }

  public async setAutoLoad(enabled: boolean): Promise<void> {
    this.updatePreference({ ...this.preference, autoLoad: enabled });
    if (enabled) await this.start();
    else await this.unload();
  }

  public async setLicenseAccepted(licenseId: string, accepted: boolean): Promise<void> {
    const values = new Set(this.preference.acceptedLicenseIds);
    if (accepted) values.add(licenseId);
    else values.delete(licenseId);
    this.updatePreference({ ...this.preference, acceptedLicenseIds: [...values].toSorted() });
    await this.start();
  }

  public async unload(): Promise<void> {
    ++this.runGeneration;
    await this.session?.unload().catch(() => undefined);
    this.session = null;
    this.update({
      phase: 'deferred',
      message: 'Локальная модель выгружена; детерминированный поиск продолжает работать.',
      progress: null,
      activeModelId: null,
      benchmark: null,
      error: null,
    });
  }

  public async dispose(): Promise<void> {
    ++this.runGeneration;
    await this.session?.unload().catch(() => undefined);
    this.session = null;
    this.listeners.clear();
  }

  public modelById(modelId: string | null): LocalModelDescriptor | null {
    if (!modelId || !this.catalog) return null;
    return this.catalog.models.find((model) => model.id === modelId) ?? null;
  }
}
