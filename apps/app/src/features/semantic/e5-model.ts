/**
 * Pinned on-device query encoder for semantic search over clinical recommendations (STATE E2,
 * ADR 0008): the ONNX int8 export of intfloat/multilingual-e5-small. The КР modules carry passage
 * vectors of the same model (`E5_SMALL_PROFILE`); query vectors from this export match the
 * reference PyTorch model at cosine ≥ 0.996 (docs/SEMANTIC_RETRIEVAL.md, «e5-small»).
 */
export const E5_MODEL_ID = 'Xenova/multilingual-e5-small';
export const E5_MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';

export interface E5ModelFile {
  /** Path inside the model repository, as transformers.js requests it. */
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export const E5_MODEL_FILES: readonly E5ModelFile[] = [
  {
    path: 'config.json',
    sizeBytes: 658,
    sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1',
  },
  {
    path: 'tokenizer_config.json',
    sizeBytes: 443,
    sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
  },
  {
    path: 'tokenizer.json',
    sizeBytes: 17_082_730,
    sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
  },
  {
    path: 'onnx/model_quantized.onnx',
    sizeBytes: 118_308_185,
    sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193',
  },
];

export const E5_MODEL_TOTAL_BYTES = E5_MODEL_FILES.reduce((sum, file) => sum + file.sizeBytes, 0);
export const E5_DOWNLOAD_ID = `model:${E5_MODEL_ID}@${E5_MODEL_REVISION.slice(0, 12)}`;

export function e5FileUrl(path: string): string {
  return `https://huggingface.co/${E5_MODEL_ID}/resolve/${E5_MODEL_REVISION}/${path}`;
}

/**
 * The pinned file a transformers.js request names, or null. transformers probes some files at
 * `main` before it honours `revision`; those probes resolve to the pinned snapshot as well.
 */
export function pinnedE5File(url: string): E5ModelFile | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== 'https://huggingface.co' || parsed.search || parsed.hash) return null;
  for (const revision of [E5_MODEL_REVISION, 'main']) {
    const prefix = `/${E5_MODEL_ID}/resolve/${revision}/`;
    if (!parsed.pathname.startsWith(prefix)) continue;
    const path = parsed.pathname.slice(prefix.length);
    return E5_MODEL_FILES.find((file) => file.path === path) ?? null;
  }
  return null;
}
