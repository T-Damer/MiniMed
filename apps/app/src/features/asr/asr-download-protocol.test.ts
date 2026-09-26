import { describe, expect, it } from 'vitest';
import {
  ASR_MODEL_REVISIONS,
  type AsrAssetRequest,
  assertAsrAssetRequest,
} from './asr-download-protocol';

const baseRevision = ASR_MODEL_REVISIONS['onnx-community/whisper-base'];
const request: AsrAssetRequest = {
  type: 'fetch-asset',
  requestId: 1,
  modelId: 'onnx-community/whisper-base',
  url: `https://huggingface.co/onnx-community/whisper-base/resolve/${baseRevision}/onnx/encoder_model_quantized.onnx`,
  metadataOnly: false,
};

describe('speech worker public-asset boundary', () => {
  it('permits approved immutable model files and one-byte metadata probes', () => {
    expect(() => assertAsrAssetRequest(request)).not.toThrow();
    expect(() => assertAsrAssetRequest({ ...request, metadataOnly: true })).not.toThrow();
  });

  it.each([
    'http://huggingface.co/onnx-community/whisper-base/resolve/main/config.json',
    'https://evil.invalid/onnx-community/whisper-base/resolve/main/config.json',
    'https://huggingface.co/other/model/resolve/main/config.json',
    'https://huggingface.co/onnx-community/whisper-base/resolve/main/config.json',
    `https://huggingface.co/onnx-community/whisper-base/resolve/${'0'.repeat(40)}/config.json`,
    `https://huggingface.co/onnx-community/whisper-base/resolve/${baseRevision}/config.json?token=private`,
    `https://token@huggingface.co/onnx-community/whisper-base/resolve/${baseRevision}/config.json`,
    `https://huggingface.co/onnx-community/whisper-small/resolve/${ASR_MODEL_REVISIONS['onnx-community/whisper-small']}/config.json`,
    `https://huggingface.co/onnx-community/whisper-base/resolve/${baseRevision}/../../other.json`,
  ])('rejects arbitrary hosts, credentials and unapproved model paths: %s', (url) => {
    expect(() => assertAsrAssetRequest({ ...request, url })).toThrow();
  });

  it('rejects unknown models and invalid message identities', () => {
    expect(() => assertAsrAssetRequest({ ...request, modelId: 'private/model' })).toThrow();
    expect(() => assertAsrAssetRequest({ ...request, requestId: -1 })).toThrow();
  });
});
