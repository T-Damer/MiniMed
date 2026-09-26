import type {
  NativeRecordingResult,
  NativeTranscriptionModelStatus,
  NativeTranscriptionProgress,
  NativeTranscriptionResult,
} from '@localmed/contracts';
import {
  NativeRecordingResultSchema,
  NativeTranscriptionProgressSchema,
  NativeTranscriptionResultSchema,
} from '@localmed/contracts';
import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';

import {
  NATIVE_TRANSCRIPTION_MODEL_BYTES,
  NATIVE_TRANSCRIPTION_MODELS,
  type NativeTranscriptionModelArtifact,
} from '@/features/asr/native-transcription-models';
import { downloadFileWithRetry } from '@/features/network/download-retry';

interface NativePermissionStatus {
  readonly microphone?: 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';
}

interface NativeModelInspection {
  readonly valid: boolean;
  readonly sizeBytes: number;
}

interface LocalMedTranscriberPlugin {
  inspectModel(options: {
    readonly fileName: string;
    readonly expectedBytes: number;
    readonly expectedSha256: string;
  }): Promise<NativeModelInspection>;
  installModelFile(options: {
    readonly fileName: string;
    readonly sourcePath: string;
    readonly expectedBytes: number;
    readonly expectedSha256: string;
  }): Promise<NativeModelInspection>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<unknown>;
  transcribe(options: { readonly filePath: string }): Promise<unknown>;
  checkPermissions(): Promise<NativePermissionStatus>;
  requestPermissions(options?: {
    readonly permissions?: readonly ['microphone'];
  }): Promise<NativePermissionStatus>;
  addListener(
    eventName: 'transcriptionProgress',
    listenerFunc: (progress: unknown) => void,
  ): Promise<PluginListenerHandle>;
}

const localMedTranscriber = registerPlugin<LocalMedTranscriberPlugin>('LocalMedTranscriber');

function assertNativeTranscriber(): void {
  if (Capacitor.getPlatform() !== 'android') {
    throw new Error('Запись с локальным распознаванием пока доступна только в Android-приложении.');
  }
}

async function inspectArtifact(
  artifact: NativeTranscriptionModelArtifact,
): Promise<NativeModelInspection> {
  return localMedTranscriber.inspectModel({
    fileName: artifact.fileName,
    expectedBytes: artifact.expectedBytes,
    expectedSha256: artifact.expectedSha256,
  });
}

export function isNativeTranscriberAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export async function getNativeTranscriptionModelStatus(): Promise<NativeTranscriptionModelStatus> {
  assertNativeTranscriber();
  const inspections = await Promise.all(NATIVE_TRANSCRIPTION_MODELS.map(inspectArtifact));
  const missingFiles = NATIVE_TRANSCRIPTION_MODELS.flatMap((artifact, index) =>
    inspections[index]?.valid ? [] : [artifact.fileName],
  );
  const bytesReady = inspections.reduce(
    (total, inspection, index) =>
      total + (inspection.valid ? (NATIVE_TRANSCRIPTION_MODELS[index]?.expectedBytes ?? 0) : 0),
    0,
  );
  return {
    ready: missingFiles.length === 0,
    missingFiles,
    bytesReady,
    bytesTotal: NATIVE_TRANSCRIPTION_MODEL_BYTES,
  };
}

export async function ensureNativeTranscriptionModels(): Promise<NativeTranscriptionModelStatus> {
  assertNativeTranscriber();
  for (const artifact of NATIVE_TRANSCRIPTION_MODELS) {
    if ((await inspectArtifact(artifact)).valid) continue;
    await downloadFileWithRetry(
      {
        url: artifact.url,
        cacheKey: `native-transcription:${artifact.id}:${artifact.expectedSha256}`,
        expectedBytes: artifact.expectedBytes,
      },
      async (file) => {
        const installed = await localMedTranscriber.installModelFile({
          fileName: artifact.fileName,
          sourcePath: file.filePath,
          expectedBytes: artifact.expectedBytes,
          expectedSha256: artifact.expectedSha256,
        });
        if (!installed.valid) {
          throw new Error(`Не удалось проверить модель распознавания «${artifact.fileName}».`);
        }
      },
    );
  }
  return getNativeTranscriptionModelStatus();
}

export async function requestNativeMicrophonePermission(): Promise<boolean> {
  assertNativeTranscriber();
  const current = await localMedTranscriber.checkPermissions();
  if (current.microphone === 'granted') return true;
  const requested = await localMedTranscriber.requestPermissions({ permissions: ['microphone'] });
  return requested.microphone === 'granted';
}

export async function startNativeRecording(): Promise<void> {
  assertNativeTranscriber();
  await localMedTranscriber.startRecording();
}

export async function stopNativeRecording(): Promise<NativeRecordingResult> {
  assertNativeTranscriber();
  return NativeRecordingResultSchema.parse(await localMedTranscriber.stopRecording());
}

export async function transcribeNativeRecording(filePath: string): Promise<NativeTranscriptionResult> {
  assertNativeTranscriber();
  if (!filePath.trim()) throw new Error('Путь к аудиозаписи пуст.');
  return NativeTranscriptionResultSchema.parse(
    await localMedTranscriber.transcribe({ filePath }),
  );
}

export async function watchNativeTranscription(
  listener: (progress: NativeTranscriptionProgress) => void,
): Promise<PluginListenerHandle> {
  assertNativeTranscriber();
  return localMedTranscriber.addListener('transcriptionProgress', (value) => {
    const parsed = NativeTranscriptionProgressSchema.safeParse(value);
    if (parsed.success) listener(parsed.data);
  });
}
