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
 *
 * The Android build bundles the same files (owner decision 2026-10-15): `scripts/fetch-query-model.ts`
 * downloads them from the mirror, checks every size and SHA-256 below, joins the parts and stages
 * them in the web assets of the APK under `E5_BUNDLED_DIR`. This module must stay free of runtime
 * imports: the build script reads it as the single source of truth for the checksums.
 */
export const E5_MODEL_ID = 'minimed/kd1-query-encoder';
export const E5_MODEL_REVISION = 'kd1-query-encoder-2026.10.11.2';

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
    sizeBytes: 598,
    sha256: '6511362e9104a0c50d56581c8e37d9303ed6d71cb411085209fe7e8ac58bad90',
  },
  {
    path: 'tokenizer.json',
    sizeBytes: 17_082_988,
    sha256: '5b58593a7e63f3c8b69801a92415fc0813dd287a3ba2f767cdf33106806fca11',
  },
  {
    path: 'onnx/model_quantized.onnx',
    sizeBytes: 118_972_175,
    sha256: '29754e981ab18fe149c110329d424add58f83ed50b4b16a51a3ba0a3d7a7c937',
    parts: [
      {
        path: 'onnx/model_quantized.onnx.part-0',
        sizeBytes: 62_914_560,
        sha256: '5afa39d6fbb946af4c770c08112d62805dc3e439c098a1488ac3b40471a86b17',
      },
      {
        path: 'onnx/model_quantized.onnx.part-1',
        sizeBytes: 56_057_615,
        sha256: '6194a2f7b7447c2168186d576628e352d138b7cfb4e024ff7dbb977ccd8a13b7',
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

/** Directory of the bundled copy in the web assets of the Android APK (relative to the app root). */
export const E5_BUNDLED_DIR = 'models/kd1-query-encoder';
/** Written last by the staging script; its presence proves a complete, verified copy. */
export const E5_BUNDLED_MANIFEST = 'manifest.json';

export interface E5BundledManifest {
  readonly revision: string;
  readonly files: readonly {
    readonly path: string;
    readonly sizeBytes: number;
    readonly sha256: string;
  }[];
}

/** The manifest the staging script writes next to the bundled files. */
export function e5BundledManifest(): E5BundledManifest {
  return {
    revision: E5_MODEL_REVISION,
    files: E5_MODEL_FILES.map(({ path, sizeBytes, sha256 }) => ({ path, sizeBytes, sha256 })),
  };
}

/** True when a parsed manifest describes exactly the pinned revision, files, sizes and checksums. */
export function isPinnedE5BundledManifest(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const { revision, files } = value as { revision?: unknown; files?: unknown };
  if (revision !== E5_MODEL_REVISION || !Array.isArray(files)) return false;
  if (files.length !== E5_MODEL_FILES.length) return false;
  return E5_MODEL_FILES.every((pinned, index) => {
    const entry = files[index] as { path?: unknown; sizeBytes?: unknown; sha256?: unknown } | null;
    return (
      entry?.path === pinned.path &&
      entry.sizeBytes === pinned.sizeBytes &&
      entry.sha256 === pinned.sha256
    );
  });
}
