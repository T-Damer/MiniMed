export interface NativeTranscriptionModelArtifact {
  readonly id:
    | 'gigaam-encoder'
    | 'gigaam-decoder'
    | 'gigaam-joiner'
    | 'gigaam-tokens'
    | 'pyannote-segmentation'
    | 'campplus-speaker';
  readonly fileName: string;
  readonly url: string;
  readonly expectedBytes: number;
  readonly expectedSha256: string;
  readonly license: 'MIT' | 'Apache-2.0';
  readonly source: string;
}

const GIGAAM_V3_RNNT_REV = 'a6039be7cee829a9044a69ac0ebaf1c191217c97';
const GIGAAM_V3_RNNT_SOURCE =
  'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-transducer-punct-giga-am-v3-russian-2025-12-16';

export const NATIVE_TRANSCRIPTION_MODELS: readonly NativeTranscriptionModelArtifact[] = [
  {
    id: 'gigaam-encoder',
    fileName: 'gigaam-v3-rnnt-punct.encoder.int8.onnx',
    url: `${GIGAAM_V3_RNNT_SOURCE}/resolve/${GIGAAM_V3_RNNT_REV}/encoder.int8.onnx?download=true`,
    expectedBytes: 224_570_820,
    expectedSha256: '369f35a71bf288d3b8e0391fabd8dba5f2314088d440bca474056b7b4b6e66bf',
    license: 'MIT',
    source: GIGAAM_V3_RNNT_SOURCE,
  },
  {
    id: 'gigaam-decoder',
    fileName: 'gigaam-v3-rnnt-punct.decoder.onnx',
    url: `${GIGAAM_V3_RNNT_SOURCE}/resolve/${GIGAAM_V3_RNNT_REV}/decoder.onnx?download=true`,
    expectedBytes: 4_600_132,
    expectedSha256: '38fc7475443ea2a26f63211ca350f73ac50fff824ab7a3876ee2bd610c53bbc4',
    license: 'MIT',
    source: GIGAAM_V3_RNNT_SOURCE,
  },
  {
    id: 'gigaam-joiner',
    fileName: 'gigaam-v3-rnnt-punct.joiner.onnx',
    url: `${GIGAAM_V3_RNNT_SOURCE}/resolve/${GIGAAM_V3_RNNT_REV}/joiner.onnx?download=true`,
    expectedBytes: 2_712_896,
    expectedSha256: '602ff7017a93311aad34df1437c8d7f49911353c13d6eae7a6ee7b041339465c',
    license: 'MIT',
    source: GIGAAM_V3_RNNT_SOURCE,
  },
  {
    id: 'gigaam-tokens',
    fileName: 'gigaam-v3-rnnt-punct.tokens.txt',
    url: `${GIGAAM_V3_RNNT_SOURCE}/resolve/${GIGAAM_V3_RNNT_REV}/tokens.txt?download=true`,
    expectedBytes: 13_354,
    expectedSha256: '39abae20e692998290c574e606f11a9edef2902a1995463fcff63d1490cf22b7',
    license: 'MIT',
    source: GIGAAM_V3_RNNT_SOURCE,
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
