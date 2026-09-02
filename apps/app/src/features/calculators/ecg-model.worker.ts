/// <reference lib="webworker" />

import { RawImage } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web';

import {
  ECG_DIGITIZER_CONFIG_FILE,
  ECG_DIGITIZER_WEIGHTS_FILE,
  type EcgDigitizationResult,
  type EcgPhotoCorners,
  ecgModelStorageUrl,
} from '@/features/calculators/ecg-model-contract';
import {
  assessEcgPhotoQuality,
  ecgPhotoRegionFromCorners,
  estimateCalibrationPixelsPerMillimeter,
  mapEcgPhotoQualityIssuesToRegion,
} from '@/features/calculators/ecg-photo-quality';
import { rectifyEcgPhotoRgb } from '@/features/calculators/ecg-photo-rectification';
import {
  enhanceSignalWithBlueInk,
  extractDigitizedEcg,
} from '@/features/calculators/ecg-waveform-digitizer';

interface DigitizeMessage {
  readonly type: 'digitize';
  readonly requestId: string;
  readonly cacheName: string;
  readonly image: ArrayBuffer;
  readonly mimeType: string;
  readonly corners?: EcgPhotoCorners;
}

interface DigitizerSpec {
  readonly format: 'open-ecg-digitizer-segmentation';
  readonly formatVersion: 1;
  readonly gridClass: number;
  readonly height: number;
  readonly signalClass: number;
  readonly width: number;
}

interface Digitizer {
  (image: Blob, corners?: EcgPhotoCorners): Promise<EcgDigitizationResult>;
  dispose: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function cachedJson(cache: Cache, path: string): Promise<unknown> {
  const response = await cache.match(ecgModelStorageUrl(path));
  if (!response) throw new Error(`Оцифровщик ЭКГ: в кеше отсутствует ${path}.`);
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch {
    throw new Error(`Оцифровщик ЭКГ: ${path} содержит неверный JSON.`);
  }
}

function parseDigitizerSpec(value: unknown): DigitizerSpec {
  if (!isRecord(value)) throw new Error('Оцифровщик ЭКГ: неверный файл конфигурации.');
  const field = (name: string): unknown => value[name];
  const number = (fieldName: string): number => {
    const candidate = field(fieldName);
    if (typeof candidate !== 'number' || !Number.isInteger(candidate) || candidate < 0) {
      throw new Error(`Оцифровщик ЭКГ: неверное поле ${fieldName}.`);
    }
    return candidate;
  };
  if (field('format') !== 'open-ecg-digitizer-segmentation' || field('formatVersion') !== 1) {
    throw new Error('Оцифровщик ЭКГ: неподдерживаемый формат модели.');
  }
  const width = number('width');
  const height = number('height');
  if (width < 128 || width > 2048 || height < 128 || height > 2048) {
    throw new Error('Оцифровщик ЭКГ: неподдерживаемый размер входа.');
  }
  return {
    format: 'open-ecg-digitizer-segmentation',
    formatVersion: 1,
    gridClass: number('gridClass'),
    height,
    signalClass: number('signalClass'),
    width,
  };
}

async function directDigitizer(cache: Cache, spec: DigitizerSpec): Promise<Digitizer> {
  const response = await cache.match(ecgModelStorageUrl(ECG_DIGITIZER_WEIGHTS_FILE));
  if (!response)
    throw new Error(`Оцифровщик ЭКГ: в кеше отсутствует ${ECG_DIGITIZER_WEIGHTS_FILE}.`);
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(await response.arrayBuffer(), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) {
    await session.release();
    throw new Error('Оцифровщик ЭКГ не содержит вход или выход ONNX.');
  }

  const digitize = async (
    image: Blob,
    corners?: EcgPhotoCorners,
  ): Promise<EcgDigitizationResult> => {
    let decoded = (await RawImage.read(image)).rgb();
    if (corners) {
      const rectified = rectifyEcgPhotoRgb(decoded, corners);
      decoded = new RawImage(rectified.data, rectified.width, rectified.height, 3);
    }
    const pixelAspectRatio = spec.height / decoded.height / (spec.width / decoded.width);
    const resized = await decoded.resize(spec.width, spec.height, { resample: 2 });
    const planeSize = spec.width * spec.height;
    const inputData = new Float32Array(planeSize * 3);
    let minimum = 255;
    let maximum = 0;
    for (const value of resized.data) {
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    const range = Math.max(1, maximum - minimum);
    for (let pixel = 0; pixel < planeSize; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const source = resized.data[pixel * 3 + channel];
        if (source === undefined) throw new Error('Оцифровщик ЭКГ получил неполное изображение.');
        inputData[channel * planeSize + pixel] = (source - minimum) / range;
      }
    }
    const input = new ort.Tensor('float32', inputData, [1, 3, spec.height, spec.width]);
    let output: ort.Tensor | undefined;
    try {
      const outputs = await session.run({ [inputName]: input });
      output = outputs[outputName];
      if (output?.type !== 'float32' || output.dims.length !== 4) {
        throw new Error('Оцифровщик ЭКГ вернул неподдерживаемую карту сегментации.');
      }
      const logits = output.data;
      if (!(logits instanceof Float32Array) || logits.length !== planeSize * 4) {
        throw new Error('Оцифровщик ЭКГ вернул неверный размер карты сегментации.');
      }
      const gridProbability = new Float32Array(planeSize);
      const signalProbability = new Float32Array(planeSize);
      for (let pixel = 0; pixel < planeSize; pixel += 1) {
        let maximumLogit = Number.NEGATIVE_INFINITY;
        for (let channel = 0; channel < 4; channel += 1) {
          maximumLogit = Math.max(
            maximumLogit,
            logits[channel * planeSize + pixel] ?? maximumLogit,
          );
        }
        let denominator = 0;
        for (let channel = 0; channel < 4; channel += 1) {
          denominator += Math.exp(
            (logits[channel * planeSize + pixel] ?? maximumLogit) - maximumLogit,
          );
        }
        gridProbability[pixel] =
          Math.exp((logits[spec.gridClass * planeSize + pixel] ?? maximumLogit) - maximumLogit) /
          denominator;
        signalProbability[pixel] =
          Math.exp((logits[spec.signalClass * planeSize + pixel] ?? maximumLogit) - maximumLogit) /
          denominator;
      }
      const enhancement = enhanceSignalWithBlueInk(signalProbability, resized.data, spec.width);
      const calibrationPixelsPerMillimeter = estimateCalibrationPixelsPerMillimeter({
        height: spec.height,
        layout: '12x1',
        rgb: resized.data,
        width: spec.width,
      });
      const result = extractDigitizedEcg({
        ...(calibrationPixelsPerMillimeter === undefined ? {} : { calibrationPixelsPerMillimeter }),
        gridProbability,
        height: spec.height,
        ...(enhancement.detected || calibrationPixelsPerMillimeter !== undefined
          ? { layoutHint: '12x1' as const }
          : {}),
        pixelAspectRatio,
        signalProbability: enhancement.signalProbability,
        width: spec.width,
      });
      const sourceIssues = assessEcgPhotoQuality({
        ...(result.detectedGridCorners ? { corners: result.detectedGridCorners } : {}),
        height: spec.height,
        layout: result.layout,
        rgb: resized.data,
        width: spec.width,
      });
      const qualityIssues =
        !corners && result.detectedGridCorners
          ? mapEcgPhotoQualityIssuesToRegion(
              sourceIssues,
              ecgPhotoRegionFromCorners(result.detectedGridCorners),
            )
          : sourceIssues;
      return {
        ...result,
        quality:
          result.quality === 'usable' && sourceIssues.some((issue) => issue.severity === 'blocking')
            ? 'review'
            : result.quality,
        qualityIssues,
      };
    } finally {
      input.dispose();
      output?.dispose();
    }
  };
  digitize.dispose = () => session.release();
  return digitize;
}

let activeCacheName = '';
let digitizer: Promise<Digitizer> | null = null;

async function digitizerFor(cacheName: string): Promise<Digitizer> {
  if (digitizer && activeCacheName === cacheName) return await digitizer;
  if (digitizer) await (await digitizer).dispose();
  activeCacheName = cacheName;
  const cache = await caches.open(cacheName);
  const spec = parseDigitizerSpec(await cachedJson(cache, ECG_DIGITIZER_CONFIG_FILE));
  digitizer = directDigitizer(cache, spec);
  return await digitizer;
}

self.onmessage = async (event: MessageEvent<DigitizeMessage>) => {
  const message = event.data;
  try {
    const run = await digitizerFor(message.cacheName);
    const result = await run(
      new Blob([message.image], { type: message.mimeType }),
      message.corners,
    );
    self.postMessage({ type: 'digitization-result', requestId: message.requestId, result });
  } catch (cause) {
    self.postMessage({
      type: 'error',
      requestId: message.requestId,
      message: cause instanceof Error ? cause.message : 'Не удалось оцифровать ЭКГ.',
    });
  }
};
