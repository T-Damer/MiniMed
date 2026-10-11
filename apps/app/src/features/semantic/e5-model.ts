/**
 * Pinned on-device query encoder for semantic search (STATE KD1, ADR 0008): multilingual-e5-small
 * distilled to place a query where Giga-Embeddings-instruct 480M places it, with a 384×384 head
 * folded into the ONNX graph. The modules carry Giga passage vectors projected to 384 dimensions
 * (`KD1_PROFILE`); docs/research/embedding-distillation-2026-10-09.md.
 *
 * transformers.js asks for the files by a Hugging Face-style URL of `E5_MODEL_ID`; the worker
 * answers those requests from the verified local copy and never fetches. The files themselves are
 * downloaded from the `datasets/<tag>` mirror branch, where the ONNX graph is split in two parts
 * because a plain git blob must stay under 100 MB.
 */
export const E5_MODEL_ID = 'minimed/kd1-query-encoder';
export const E5_MODEL_REVISION = 'kd1-query-encoder-2026.10.11';

const MIRROR_BASE = `https://raw.githubusercontent.com/T-Damer/MiniMed/datasets/${E5_MODEL_REVISION}/models/kd1-query-encoder`;

export interface E5ModelPart {
  /** Path of the part on the mirror branch. */
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface E5ModelFile {
  /** Path inside the model repository, as transformers.js requests it. */
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  /** Downloaded part by part and joined; absent when the file is published whole. */
  readonly parts?: readonly E5ModelPart[];
}

export const E5_MODEL_FILES: readonly E5ModelFile[] = [
  {
    path: 'config.json',
    sizeBytes: 756,
    sha256: '1a22f9edc7d2b364dcb86440a95c9114b31aa4a45a0d83a13722c6134b490024',
  },
  {
    path: 'tokenizer_config.json',
    sizeBytes: 408,
    sha256: '277f5c176756cd784d10b9eddfedd5ebd2281d7791d5682fb2dace09080a2f16',
  },
  {
    path: 'tokenizer.json',
    sizeBytes: 17_082_988,
    sha256: '5b58593a7e63f3c8b69801a92415fc0813dd287a3ba2f767cdf33106806fca11',
  },
  {
    path: 'onnx/model_quantized.onnx',
    sizeBytes: 118_972_175,
    sha256: '14019498821496b8248f1a172994110758161ba1d1ea2d0e9472338e4096b671',
    parts: [
      {
        path: 'onnx/model_quantized.onnx.part-0',
        sizeBytes: 62_914_560,
        sha256: '4b4fe50f6b1dcdea52e02f0aba8948a77842e92b68dfd53727361ecffc58e696',
      },
      {
        path: 'onnx/model_quantized.onnx.part-1',
        sizeBytes: 56_057_615,
        sha256: 'b076c79729a7673ad12d59a2bbb0ea41b2da4370974b0c756e0c9e8d29fa2813',
      },
    ],
  },
];

export const E5_MODEL_TOTAL_BYTES = E5_MODEL_FILES.reduce((sum, file) => sum + file.sizeBytes, 0);
export const E5_DOWNLOAD_ID = `model:${E5_MODEL_ID}@${E5_MODEL_REVISION}`;

/** Where a file (or one part of it) is downloaded from. */
export function e5FileUrl(path: string): string {
  return `${MIRROR_BASE}/${path}`;
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
