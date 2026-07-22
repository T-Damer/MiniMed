import type {
  LocalModelArtifact,
  LocalModelDescriptor,
  LocalModelDeviceProfile,
  LocalModelLoadCallbacks,
  LocalModelRuntime,
  LocalModelSession,
} from './types';

interface WllamaProgress {
  readonly loaded: number;
  readonly total: number;
}

interface WllamaChoice {
  readonly message?: {
    readonly content?: string | null;
  };
}

interface WllamaCompletion {
  readonly choices?: readonly WllamaChoice[];
}

interface WllamaInstance {
  loadModelFromUrl(
    url: string,
    options: {
      readonly n_ctx: number;
      readonly n_threads: number;
      readonly n_gpu_layers: number;
      readonly progressCallback: (progress: WllamaProgress) => void;
    },
  ): Promise<void>;
  createChatCompletion(options: {
    readonly messages: readonly { readonly role: 'system' | 'user'; readonly content: string }[];
    readonly max_tokens: number;
    readonly temperature: number;
    readonly top_p: number;
  }): Promise<WllamaCompletion>;
  exit?(): Promise<void> | void;
  unloadModel?(): Promise<void> | void;
}

interface WllamaConstructor {
  new (
    paths: Readonly<Record<string, string>>,
    options?: {
      readonly parallelDownloads?: number;
      readonly logger?: Readonly<Record<string, (...values: readonly unknown[]) => void>>;
    },
  ): WllamaInstance;
}

interface WllamaModule {
  readonly Wllama: WllamaConstructor;
}

export interface BrowserWllamaRuntimeOptions {
  readonly moduleUrl: string;
  readonly wasmUrl: string;
  readonly mirrorBaseUrl: string;
  readonly allowUpstreamFallback: boolean;
  readonly enableWebgpu: boolean;
}

function asWllamaModule(value: unknown): WllamaModule {
  if (typeof value !== 'object' || value === null) throw new Error('Модуль wllama не загрузился.');
  const candidate = value as Readonly<Record<string, unknown>>;
  if (typeof candidate['Wllama'] !== 'function') {
    throw new Error('Загруженный модуль не экспортирует Wllama.');
  }
  return candidate as unknown as WllamaModule;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/u, '')}/${path.replace(/^\//u, '')}`;
}

function extractJson(value: string): unknown | null {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(value.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

class BrowserWllamaSession implements LocalModelSession {
  public readonly modelId: string;
  public readonly artifactId: string;

  public constructor(
    modelId: string,
    artifactId: string,
    private readonly instance: WllamaInstance,
  ) {
    this.modelId = modelId;
    this.artifactId = artifactId;
  }

  public async benchmark() {
    const startedAt = performance.now();
    const result = await this.instance.createChatCompletion({
      messages: [
        {
          role: 'system',
          content:
            'Ты локальный классификатор медицинского поиска. Верни только компактный JSON без пояснений.',
        },
        {
          role: 'user',
          content:
            'Запрос: девочка 3 лет, лечение бронхиальной астмы при потере контроля. Поля: intent, ageYears, concepts.',
        },
      ],
      max_tokens: 48,
      temperature: 0,
      top_p: 1,
    });
    const generationMs = performance.now() - startedAt;
    const output = result.choices?.[0]?.message?.content?.trim() ?? '';
    const parsed = extractJson(output);
    const validStructuredOutput =
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
    return {
      modelId: this.modelId,
      artifactId: this.artifactId,
      runtime: 'wllama-web' as const,
      generationMs,
      outputCharacters: output.length,
      validStructuredOutput,
    };
  }

  public async unload(): Promise<void> {
    if (this.instance.unloadModel) {
      await this.instance.unloadModel();
      return;
    }
    if (this.instance.exit) await this.instance.exit();
  }
}

export class BrowserWllamaRuntime implements LocalModelRuntime {
  public readonly kind = 'wllama-web' as const;

  public constructor(private readonly options: BrowserWllamaRuntimeOptions) {}

  public async isAvailable(_profile: LocalModelDeviceProfile): Promise<boolean> {
    return typeof WebAssembly === 'object' && typeof Worker === 'function';
  }

  public async load(
    model: LocalModelDescriptor,
    artifact: LocalModelArtifact,
    profile: LocalModelDeviceProfile,
    callbacks: LocalModelLoadCallbacks,
  ): Promise<LocalModelSession> {
    const imported: unknown = await import(/* @vite-ignore */ this.options.moduleUrl);
    const module = asWllamaModule(imported);
    const instance = new module.Wllama(
      { default: this.options.wasmUrl },
      {
        parallelDownloads: 3,
        logger: {
          debug: () => undefined,
          log: () => undefined,
          warn: (...values) => console.warn('[local-model]', ...values),
          error: (...values) => console.error('[local-model]', ...values),
        },
      },
    );
    const urls: string[] = [];
    if (this.options.mirrorBaseUrl.trim() && artifact.mirrorPath) {
      urls.push(joinUrl(this.options.mirrorBaseUrl, artifact.mirrorPath));
    }
    if (this.options.allowUpstreamFallback || urls.length === 0) urls.push(artifact.upstreamUrl);

    let lastError: unknown;
    for (const url of urls) {
      try {
        await instance.loadModelFromUrl(url, {
          n_ctx: Math.min(artifact.maxContextTokens, 2048),
          n_threads: Math.max(1, Math.min(6, profile.hardwareConcurrency - 1)),
          n_gpu_layers: this.options.enableWebgpu && profile.webgpu ? 8 : 0,
          progressCallback: ({ loaded, total }) => callbacks.onProgress(loaded, total),
        });
        return new BrowserWllamaSession(model.id, artifact.id, instance);
      } catch (cause) {
        lastError = cause;
      }
    }
    await instance.exit?.();
    throw lastError instanceof Error
      ? lastError
      : new Error(`Не удалось загрузить ${model.name}.`);
  }
}
