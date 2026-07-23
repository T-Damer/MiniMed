import { SerialAsyncQueue } from './serial-async-queue';
import { extractStructuredJson, normalizeLocalModelProbe } from './structured-output';
import type {
  LocalModelArtifact,
  LocalModelDescriptor,
  LocalModelDeviceProfile,
  LocalModelLoadCallbacks,
  LocalModelRuntime,
  LocalModelSession,
  LocalModelStructuredRequest,
  LocalModelStructuredResponse,
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
}

function asWllamaModule(value: unknown): WllamaModule {
  if (typeof value !== 'object' || value === null)
    throw new Error('Компонент локальной модели не загрузился.');
  const candidate = value as Readonly<Record<string, unknown>>;
  if (typeof candidate['Wllama'] !== 'function') {
    throw new Error('Компонент локальной модели имеет неподдерживаемый формат.');
  }
  return candidate as unknown as WllamaModule;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/u, '')}/${path.replace(/^\//u, '')}`;
}

function outputPreview(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim();
  return compact.length > 900 ? `${compact.slice(0, 900)}…` : compact;
}

class BrowserWllamaSession implements LocalModelSession {
  private readonly structuredTasks = new SerialAsyncQueue();

  public readonly modelId: string;
  public readonly artifactId: string;

  public constructor(
    private readonly model: LocalModelDescriptor,
    artifactId: string,
    private readonly instance: WllamaInstance,
  ) {
    this.modelId = model.id;
    this.artifactId = artifactId;
  }

  private async runStructured(
    request: LocalModelStructuredRequest,
  ): Promise<LocalModelStructuredResponse> {
    const startedAt = performance.now();
    const noThinking = this.model.family.includes('qwen3') ? '/no_think\n' : '';
    const result = await this.instance.createChatCompletion({
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: `${noThinking}${request.userPrompt}` },
      ],
      max_tokens: Math.max(32, Math.min(512, Math.round(request.maxTokens))),
      temperature: Math.max(0, Math.min(0.4, request.temperature ?? 0)),
      top_p: 1,
    });
    const rawText = result.choices?.[0]?.message?.content?.trim() ?? '';
    return {
      task: request.task,
      rawText,
      parsedJson: extractStructuredJson(rawText),
      generationMs: performance.now() - startedAt,
    };
  }

  public completeStructured(
    request: LocalModelStructuredRequest,
  ): Promise<LocalModelStructuredResponse> {
    return this.structuredTasks.run(() => this.runStructured(request));
  }

  public async benchmark() {
    const probes: readonly LocalModelStructuredRequest[] = [
      {
        task: 'query-plan',
        systemPrompt:
          'Проверка локальной модели. Не рассуждай и не добавляй пояснений. Верни только один JSON-объект.',
        userPrompt:
          'Повтори структуру с теми же ключами: {"intent":"search","ageYears":3,"concepts":["астма"]}',
        maxTokens: 120,
      },
      {
        task: 'query-plan',
        systemPrompt: 'Верни только JSON без Markdown и текста до или после объекта.',
        userPrompt:
          'Ответ должен содержать intent строкой, ageYears числом 3 и concepts непустым массивом строк. Запрос: астма у ребёнка.',
        maxTokens: 160,
      },
    ];
    const previews: string[] = [];
    let totalGenerationMs = 0;
    let totalOutputCharacters = 0;

    for (const probe of probes) {
      const response = await this.completeStructured(probe);
      totalGenerationMs += response.generationMs;
      totalOutputCharacters += response.rawText.length;
      if (normalizeLocalModelProbe(response.parsedJson)) {
        return {
          modelId: this.modelId,
          artifactId: this.artifactId,
          runtime: 'wllama-web' as const,
          generationMs: totalGenerationMs,
          outputCharacters: totalOutputCharacters,
          validStructuredOutput: true,
        };
      }
      previews.push(outputPreview(response.rawText) || 'Модель не вернула текст.');
    }

    throw new Error(
      `Модель загрузилась и ответила, но не смогла вернуть требуемый JSON после двух попыток. ` +
        `Ответы: ${previews.map((preview, index) => `${index + 1}) «${preview}»`).join(' ')}`,
    );
  }

  public async unload(): Promise<void> {
    await this.structuredTasks.close();
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
          // wllama is a WebAssembly CPU runtime and does not implement WebGPU.
          n_gpu_layers: 0,
          progressCallback: ({ loaded, total }) => callbacks.onProgress(loaded, total),
        });
        return new BrowserWllamaSession(model, artifact.id, instance);
      } catch (cause) {
        lastError = cause;
      }
    }
    await instance.exit?.();
    const detail = lastError instanceof Error ? lastError.message : 'неизвестная ошибка';
    throw new Error(`Не удалось скачать или открыть ${model.name}: ${detail}`);
  }
}
