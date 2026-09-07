/** Narrow, public-asset-only messages. Audio and transcription never enter this transport. */
export interface AsrAssetRequest {
  readonly type: 'fetch-asset';
  readonly requestId: number;
  readonly modelId: string;
  readonly url: string;
  readonly metadataOnly: boolean;
}
export interface AsrAssetResponse {
  readonly type: 'asset-response';
  readonly requestId: number;
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly bytes: ArrayBuffer | null;
  readonly error?: string;
}
export const ASR_DOWNLOAD_VERSION = 'transformers-whisper-q8-v1';
const SUPPORTED = new Set(['onnx-community/whisper-base', 'onnx-community/whisper-small']);
export const asrDownloadId = (modelId: string): string => `speech:${modelId}`;

export function assertAsrAssetRequest(request: AsrAssetRequest): void {
  if (
    !SUPPORTED.has(request.modelId) ||
    !Number.isSafeInteger(request.requestId) ||
    request.requestId < 1 ||
    typeof request.metadataOnly !== 'boolean'
  )
    throw new Error('Invalid speech asset request.');
  const url = new URL(request.url);
  // A worker cannot turn a model download into a request to an arbitrary host or send audio.
  if (
    url.origin !== 'https://huggingface.co' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(`/${request.modelId}/resolve/`) ||
    !/^\/(onnx-community\/whisper-(base|small))\/resolve\/(main|[a-f0-9]{40})\/[A-Za-z0-9_./-]+$/u.test(
      url.pathname,
    ) ||
    url.pathname.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('Unsupported speech asset URL.');
}
