import manifestJson from '@/features/sections/section-manifest.json';
import { type SectionManifest, SectionManifestSchema } from './section-manifest-source';

/**
 * The build-time manifest of `scripts/build-section-manifest.ts`: which drug groups each clinical
 * section needs. About 20 kB, so it is bundled; it is checked once at load, never trusted blindly.
 */
let parsed: SectionManifest | undefined;

export function sectionManifest(): SectionManifest {
  parsed ??= SectionManifestSchema.parse(manifestJson);
  return parsed;
}
