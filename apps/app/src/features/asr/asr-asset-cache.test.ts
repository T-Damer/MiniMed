import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  installMultiStoreIndexedDbDouble,
  type IndexedDbStoreDouble,
} from '@/features/network/indexeddb-test-double';

import {
  commitAsrModelCacheManifest,
  deleteCachedAsrModel,
  hasCompleteCachedAsrModel,
  readCachedAsrAsset,
  storeAsrAssetBytes,
} from './asr-asset-cache';
import { ASR_MODEL_REVISIONS } from './asr-download-protocol';

const baseId = 'onnx-community/whisper-base' as const;
const smallId = 'onnx-community/whisper-small' as const;

function modelUrl(modelId: typeof baseId | typeof smallId): string {
  return `https://huggingface.co/${modelId}/resolve/${ASR_MODEL_REVISIONS[modelId]}/model.onnx`;
}

describe('Whisper persistent asset cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deletes only the requested admitted model and leaves the other model offline-ready', async () => {
    const stores = new Map<string, IndexedDbStoreDouble>();
    installMultiStoreIndexedDbDouble(stores);

    const baseUrl = modelUrl(baseId);
    const smallUrl = modelUrl(smallId);
    const baseBytes = new Uint8Array([1, 2, 3, 4]);
    const smallBytes = new Uint8Array([9, 8, 7, 6, 5]);

    await storeAsrAssetBytes({ modelId: baseId, url: baseUrl, bytes: baseBytes });
    await commitAsrModelCacheManifest(baseId, [{ url: baseUrl, needsBytes: true }]);

    await storeAsrAssetBytes({ modelId: smallId, url: smallUrl, bytes: smallBytes });
    await commitAsrModelCacheManifest(smallId, [{ url: smallUrl, needsBytes: true }]);

    await expect(hasCompleteCachedAsrModel(baseId)).resolves.toBe(true);
    await expect(hasCompleteCachedAsrModel(smallId)).resolves.toBe(true);

    await deleteCachedAsrModel(baseId);

    await expect(hasCompleteCachedAsrModel(baseId)).resolves.toBe(false);
    await expect(readCachedAsrAsset(baseId, baseUrl)).resolves.toBeNull();

    await expect(hasCompleteCachedAsrModel(smallId)).resolves.toBe(true);
    const small = await readCachedAsrAsset(smallId, smallUrl);
    expect([...(small?.bytes ?? [])]).toEqual([...smallBytes]);

    expect(stores.get('models')?.records.has(baseId)).toBe(false);
    expect(stores.get('models')?.records.has(smallId)).toBe(true);
  });
});
