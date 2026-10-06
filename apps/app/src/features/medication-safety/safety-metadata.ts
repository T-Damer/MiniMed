/** Small readers of an instruction document's stored metadata, for the safety index (SAFE1). */
import { instructionSourceClassOf } from '@/features/medications/instruction-source';

export function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** 1 for a holder's own site, 0 for a ГРЛС file. */
export function sectionOfMetadata(metadata: Readonly<Record<string, unknown>>): 0 | 1 {
  return instructionSourceClassOf(metadata) === 'manufacturer-site' ? 1 : 0;
}
