import { z } from 'zod';

import { SKIN_CLASSES } from '@/features/skin/skin-model';

/**
 * The manifest beside the weights, written by tools/derm-cnn on export. It lives in the skin pack
 * (`skin-model.json`) and, for development only, in `public/models/skin/`.
 */
export const SkinModelManifestSchema = z.object({
  format: z.literal('minimed-skin-cnn'),
  version: z.literal(2),
  /** One graph, or several whose probabilities are averaged (an ensemble). */
  models: z
    .array(
      z.object({
        file: z.string().regex(/^[\w.-]+\.onnx$/u),
        inputSide: z.number().int().min(96).max(512),
        details: z.boolean(),
      }),
    )
    .min(1)
    .max(4),
  classes: z.array(z.string()).min(2),
  /** Sum of the malignant classes' probabilities at which the check fires (set on validation). */
  malignantThreshold: z.number().min(0).max(1),
});
export type SkinModelManifest = z.infer<typeof SkinModelManifestSchema>;

/** The model's classes must be the app's, in the same order: a stale model is reported missing. */
export function manifestMatchesClasses(manifest: SkinModelManifest): boolean {
  return (
    manifest.classes.length === SKIN_CLASSES.length &&
    manifest.classes.every((id, index) => SKIN_CLASSES[index]?.id === id)
  );
}

/** Parses manifest bytes; undefined when they are not a manifest of this app's classes. */
export function parseSkinModelManifest(text: string): SkinModelManifest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = SkinModelManifestSchema.safeParse(value);
  return parsed.success && manifestMatchesClasses(parsed.data) ? parsed.data : undefined;
}
