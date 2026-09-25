import { downloadWithRetry } from '@/features/network/download-retry';

export interface BrowserDiarizationModelArtifact {
  readonly id: 'pyannote-segmentation' | 'campplus-speaker';
  readonly fileName: string;
  readonly url: string;
  readonly expectedBytes: number;
  readonly expectedSha256: string;
  readonly license: 'MIT' | 'Apache-2.0';
  readonly source: string;
}

export const BROWSER_DIARIZATION_MODELS: readonly BrowserDiarizationModelArtifact[] = [
  {
    id: 'pyannote-segmentation',
    fileName: 'pyannote-segmentation-3.0.int8.onnx',
    url: 'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/9403a6902bb58e3d5ae8c7e77c3422de279db2e0/model.int8.onnx?download=true',
    expectedBytes: 1_540_506,
    expectedSha256: 'd582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d',
    license: 'MIT',
    source: 'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0',
  },
  {
    id: 'campplus-speaker',
    fileName: 'campplus-voxceleb-16k.onnx',
    url: 'https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/8be2a75c9ed7a590538b268e46fbb65e1aa9d208/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx?download=true',
    expectedBytes: 29_596_978,
    expectedSha256: '357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b',
    license: 'Apache-2.0',
    source: 'https://huggingface.co/csukuangfj/speaker-embedding-models',
  },
] as const;

export const BROWSER_DIARIZATION_MODEL_BYTES = BROWSER_DIARIZATION_MODELS.reduce(
  (total, artifact) => total + artifact.expectedBytes,
  0,
);

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyBrowserDiarizationArtifact(
  bytes: Uint8Array,
  artifact: BrowserDiarizationModelArtifact,
): Promise<void> {
  if (bytes.byteLength !== artifact.expectedBytes) {
    throw new Error(
      `Размер модели «${artifact.fileName}» не совпал: ${bytes.byteLength} != ${artifact.expectedBytes}.`,
    );
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)),
  );
  const actual = bytesToHex(digest);
  if (actual !== artifact.expectedSha256) {
    throw new Error(`Контрольная сумма модели «${artifact.fileName}» не совпала.`);
  }
}

export interface BrowserDiarizationModelBytes {
  readonly segmentation: Uint8Array;
  readonly embedding: Uint8Array;
}

export async function downloadBrowserDiarizationModels(
  signal?: AbortSignal,
): Promise<BrowserDiarizationModelBytes> {
  const values = new Map<BrowserDiarizationModelArtifact['id'], Uint8Array>();
  for (const artifact of BROWSER_DIARIZATION_MODELS) {
    const bytes = await downloadWithRetry({
      url: artifact.url,
      cacheKey: `browser-diarization:${artifact.id}:${artifact.expectedSha256}`,
      expectedBytes: artifact.expectedBytes,
      ...(signal ? { signal } : {}),
      retryMissingAssets: false,
    });
    await verifyBrowserDiarizationArtifact(bytes, artifact);
    values.set(artifact.id, bytes);
  }

  const segmentation = values.get('pyannote-segmentation');
  const embedding = values.get('campplus-speaker');
  if (!segmentation || !embedding) {
    throw new Error('Не удалось подготовить модели разделения спикеров.');
  }
  return { segmentation, embedding };
}
