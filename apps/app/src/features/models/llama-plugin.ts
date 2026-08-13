import { type PluginListenerHandle, registerPlugin } from '@capacitor/core';

export interface LlamaEnsureModelOptions {
  readonly url: string;
  readonly mirrorUrl: string | null;
  readonly fileName: string;
  readonly expectedSha256: string;
  readonly expectedBytes: number;
}

export interface LlamaEnsureModelResult {
  readonly path: string;
}

export interface LlamaInitializeOptions {
  readonly path: string;
}

export interface LlamaCompleteOptions {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly maxTokens: number;
}

export interface LlamaCompleteResult {
  readonly text: string;
}

export interface LlamaDownloadProgressEvent {
  readonly loaded: number;
  readonly total: number;
}

export interface LlamaInferencePlugin {
  ensureModel(options: LlamaEnsureModelOptions): Promise<LlamaEnsureModelResult>;
  cancelEnsureModel(): Promise<void>;
  initializeModel(options: LlamaInitializeOptions): Promise<void>;
  complete(options: LlamaCompleteOptions): Promise<LlamaCompleteResult>;
  unload(): Promise<void>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (event: LlamaDownloadProgressEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export const LlamaInference = registerPlugin<LlamaInferencePlugin>('LlamaInference');
