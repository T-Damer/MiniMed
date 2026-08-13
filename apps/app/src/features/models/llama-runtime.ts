import { LlamaInference } from '@/features/models/llama-plugin';
import { SerialAsyncQueue } from '@/features/models/serial-async-queue';
import {
  extractStructuredJson,
  normalizeLocalModelProbe,
} from '@/features/models/structured-output';
import type {
  LocalModelArtifact,
  LocalModelDescriptor,
  LocalModelDeviceProfile,
  LocalModelLoadCallbacks,
  LocalModelRuntime,
  LocalModelSession,
  LocalModelStructuredRequest,
  LocalModelStructuredResponse,
} from '@/features/models/types';

export interface LlamaNativeRuntimeOptions {
  readonly mirrorBaseUrl: string;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/u, '')}/${path.replace(/^\//u, '')}`;
}

function outputPreview(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim();
  return compact.length > 900 ? `${compact.slice(0, 900)}…` : compact;
}

class LlamaNativeSession implements LocalModelSession {
  private readonly structuredTasks = new SerialAsyncQueue();

  public readonly modelId: string;
  public readonly artifactId: string;

  public constructor(
    private readonly model: LocalModelDescriptor,
    artifactId: string,
  ) {
    this.modelId = model.id;
    this.artifactId = artifactId;
  }

  private async runStructured(
    request: LocalModelStructuredRequest,
  ): Promise<LocalModelStructuredResponse> {
    const startedAt = performance.now();
    // Matches BrowserWllamaSession.runStructured()'s exact same family-specific prompt convention
    // — these are the same GGUF artifacts, just loaded natively instead of through WASM.
    const noThinking = this.model.family.includes('qwen3') ? '/no_think\n' : '';
    const result = await LlamaInference.complete({
      systemPrompt: request.systemPrompt,
      userPrompt: `${noThinking}${request.userPrompt}`,
      maxTokens: Math.max(32, Math.min(512, Math.round(request.maxTokens))),
    });
    const rawText = result.text.trim();
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
          'Ответ должен содержать intent строкой, ageYears числом 3 и concepts непустым массивом строк. Запрос: астма у ребенка.',
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
          runtime: 'llama-native' as const,
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
    await LlamaInference.unload().catch(() => undefined);
  }
}

export class LlamaNativeRuntime implements LocalModelRuntime {
  public readonly kind = 'llama-native' as const;
  private cancelled = false;

  public constructor(private readonly options: LlamaNativeRuntimeOptions) {}

  public cancelActiveLoad(): void {
    this.cancelled = true;
    void LlamaInference.cancelEnsureModel().catch(() => undefined);
  }

  public async isAvailable(profile: LocalModelDeviceProfile): Promise<boolean> {
    // Android-only for this pass — iOS needs its own Xcode/CMake toolchain wiring, deferred to a
    // follow-up once this pattern is proven on one platform (same reasoning as the Cactus attempt).
    return profile.platform === 'android' && profile.nativeContainer;
  }

  public async load(
    model: LocalModelDescriptor,
    artifact: LocalModelArtifact,
    _profile: LocalModelDeviceProfile,
    callbacks: LocalModelLoadCallbacks,
  ): Promise<LocalModelSession> {
    if (!artifact.sha256) {
      throw new Error(
        `${model.name}: у нативного артефакта llama.cpp отсутствует проверочная контрольная сумма SHA-256.`,
      );
    }
    this.cancelled = false;
    const listener = await LlamaInference.addListener('downloadProgress', (event) => {
      callbacks.onProgress(event.loaded, event.total);
    });
    try {
      const mirrorUrl =
        this.options.mirrorBaseUrl.trim() && artifact.mirrorPath
          ? joinUrl(this.options.mirrorBaseUrl, artifact.mirrorPath)
          : null;
      const ensured = await LlamaInference.ensureModel({
        url: artifact.upstreamUrl,
        mirrorUrl,
        fileName: artifact.mirrorPath ?? `${artifact.id}.gguf`,
        expectedSha256: artifact.sha256,
        expectedBytes: artifact.downloadBytes,
      });
      if (this.cancelled) throw new Error('Загрузка отменена.');
      await LlamaInference.initializeModel({ path: ensured.path });
      return new LlamaNativeSession(model, artifact.id);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'неизвестная ошибка';
      throw new Error(`Не удалось загрузить ${model.name}: ${detail}`);
    } finally {
      await listener.remove();
    }
  }
}
