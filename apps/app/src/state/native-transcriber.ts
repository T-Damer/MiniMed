import type {
  NativeRecordingResult,
  NativeTranscriptionModelStatus,
  NativeTranscriptionProgress,
  NativeTranscriptionResult,
} from '@localmed/contracts';
import {
  NativeRecordingResultSchema,
  NativeTranscriptionModelStatusSchema,
  NativeTranscriptionProgressSchema,
  NativeTranscriptionResultSchema,
} from '@localmed/contracts';
import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';

interface NativePermissionStatus {
  readonly microphone?: 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied';
}

interface LocalMedTranscriberPlugin {
  ensureModels(): Promise<unknown>;
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
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Запись с локальным распознаванием доступна в приложении MiniMed.');
  }
}

export function isNativeTranscriberAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export async function ensureNativeTranscriptionModels(): Promise<NativeTranscriptionModelStatus> {
  assertNativeTranscriber();
  return NativeTranscriptionModelStatusSchema.parse(await localMedTranscriber.ensureModels());
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
