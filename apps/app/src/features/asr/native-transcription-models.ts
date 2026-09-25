export interface NativeTranscriptionModelArtifact {
  readonly id: 'gigaam-asr' | 'pyannote-segmentation' | 'campplus-speaker';
  readonly fileName: string;
  readonly url: string;
  readonly expectedBytes: number;
  readonly expectedSha256: string;
  readonly license: 'MIT' | 'Apache-2.0';
  readonly source: string;
}

export const NATIVE_TRANSCRIPTION_MODELS: readonly NativeTranscriptionModelArtifact[] = [
  {
    id: 'gigaam-asr',
    fileName: 'gigaam-v3-punct.int8.onnx',
    url: 'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-ctc-punct-giga-am-v3-russian-2025-12-16/resolve/360529f65d9687a7b1c2177130262819e51557da/model.int8.onnx?download=true',
    expectedBytes: 224_893_661,
    expectedSha256: 'd5fea8df94263c285e54b21e5774b707c707192d3bdbeffd7b1eb07fb6743b35',
    license: 'MIT',
    source:
      'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-ctc-punct-giga-am-v3-russian-2025-12-16',
  },
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

export const NATIVE_TRANSCRIPTION_MODEL_BYTES = NATIVE_TRANSCRIPTION_MODELS.reduce(
  (total, artifact) => total + artifact.expectedBytes,
  0,
);
