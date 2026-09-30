import { z } from 'zod';

const identity = z.string().min(1);
const moduleTarget = { moduleId: identity, moduleVersion: identity };

/** Source-local navigation, never a canonical clinical same-as assertion. */
export const CoreIdentityTargetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('definition'),
    ...moduleTarget,
    entityId: identity,
    editionId: identity,
  }),
  z.object({
    type: z.literal('document'),
    ...moduleTarget,
    documentId: identity,
    documentVersionId: identity,
    sourceChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    anchor: identity,
  }),
]);

export const CoreIdentityHitSchema = z.object({
  name: identity,
  title: identity,
  kind: identity,
  coverage: identity,
  target: CoreIdentityTargetSchema,
});
export type CoreIdentityHit = z.infer<typeof CoreIdentityHitSchema>;

/** Matches the definition reference name key; displayed source names are preserved. */
export function normalizeCoreIdentityName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
}
