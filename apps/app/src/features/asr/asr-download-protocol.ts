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

export const ASR_DOWNLOAD_VERSION = 'transformers-whisper-q8-v2-pinned-cache';

export const ASR_MODEL_REVISIONS = {
  'onnx-community/whisper-base': '1846881b6b3a3024392c1eea3ad983695bc23925',
  'onnx-community/whisper-small': '36050c46d777d46dc4b5f43f6d90574fc38f8732',
} as const;

export type SupportedAsrModelId = keyof typeof ASR_MODEL_REVISIONS;

const SUPPORTED = new Set<string>(Object.keys(ASR_MODEL_REVISIONS));

export const asrDownloadId = (modelId: string): string => `speech:${modelId}`;

export function isSupportedAsrModelId(modelId: string): modelId is SupportedAsrModelId {
  return SUPPORTED.has(modelId);
}

export function assertAsrAssetRequest(
  request: AsrAssetRequest,
): asserts request is AsrAssetRequest & { readonly modelId: SupportedAsrModelId } {
  if (
    !isSupportedAsrModelId(request.modelId) ||
    !Number.isSafeInteger(request.requestId) ||
    request.requestId < 1 ||
    typeof request.metadataOnly !== 'boolean'
  ) {
    throw new Error('Invalid speech asset request.');
  }
  const url = new URL(request.url);
  const revision = ASR_MODEL_REVISIONS[request.modelId];
  const expectedPrefix = `/${request.modelId}/resolve/${revision}/`;
  // A worker cannot turn a model download into a request to an arbitrary host or send audio.
  if (
    url.origin !== 'https://huggingface.co' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(expectedPrefix) ||
    url.pathname.split('/').some((part) => part === '.' || part === '..') ||
    !/^[A-Za-z0-9_./-]+$/u.test(url.pathname.slice(expectedPrefix.length))
  ) {
    throw new Error('Unsupported speech asset URL.');
  }
}
