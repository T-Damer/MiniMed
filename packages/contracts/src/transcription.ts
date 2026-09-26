import { z } from 'zod';

export const RecordingContainerSchema = z.enum(['ogg-opus', 'm4a-aac']);
export type RecordingContainer = z.infer<typeof RecordingContainerSchema>;

export const NativeRecordingResultSchema = z.object({
  filePath: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  container: RecordingContainerSchema,
  durationMs: z.number().int().nonnegative(),
});
export type NativeRecordingResult = z.infer<typeof NativeRecordingResultSchema>;

export const TranscriptionSpeakerSegmentSchema = z
  .object({
    speakerId: z.string().min(1).max(64),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z.string(),
  })
  .refine((value) => value.endMs > value.startMs, {
    message: 'Speaker segment end must be after its start.',
  });
export type TranscriptionSpeakerSegment = z.infer<typeof TranscriptionSpeakerSegmentSchema>;

export const NativeTranscriptionResultSchema = z.object({
  language: z.literal('ru'),
  durationMs: z.number().int().nonnegative(),
  segments: z.array(TranscriptionSpeakerSegmentSchema),
});
export type NativeTranscriptionResult = z.infer<typeof NativeTranscriptionResultSchema>;

export const NativeTranscriptionProgressSchema = z.object({
  stage: z.enum(['preparing', 'diarizing', 'transcribing', 'finalizing']),
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  message: z.string().optional(),
});
export type NativeTranscriptionProgress = z.infer<typeof NativeTranscriptionProgressSchema>;

export const NativeTranscriptionModelStatusSchema = z.object({
  ready: z.boolean(),
  missingFiles: z.array(z.string()),
  bytesReady: z.number().int().nonnegative(),
  bytesTotal: z.number().int().nonnegative(),
});
export type NativeTranscriptionModelStatus = z.infer<typeof NativeTranscriptionModelStatusSchema>;

export interface NativeTranscriberPort {
  ensureModels(): Promise<NativeTranscriptionModelStatus>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<NativeRecordingResult>;
  transcribe(filePath: string): Promise<NativeTranscriptionResult>;
}
