/**
 * Prints `tag<TAB>file<TAB>bytes<TAB>sha256hex` for every catalog artifact that the Pages build
 * must mirror (GitHub release hosts send no CORS headers). Derived from the catalogs, never
 * hard-coded, so a newly advertised data release cannot ship without its mirror.
 */
import { readFileSync } from 'node:fs';

import { MIRRORED_DATA_RELEASE_TAG } from '../apps/app/src/features/network/mirrored-release-tags';

const RELEASE_URL =
  /^https:\/\/github\.com\/T-Damer\/MiniMed\/releases\/download\/([^/]+)\/([^/?#]+)$/u;

interface Artifact {
  readonly url?: string | null;
  readonly sha256?: string | null;
  readonly sizeBytes?: number | null;
}

function modules(path: string): readonly { readonly artifacts?: readonly Artifact[] }[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && 'modules' in parsed && Array.isArray(parsed.modules))
    return parsed.modules;
  throw new Error(`Unexpected catalog shape: ${path}`);
}

const seen = new Map<string, string>();
for (const path of [
  'apps/app/src/features/modules/catalog.preview.json',
  'apps/app/src/features/modules/catalog.terminology.json',
]) {
  for (const module of modules(path)) {
    for (const artifact of module.artifacts ?? []) {
      const match = RELEASE_URL.exec(artifact.url ?? '');
      const tag = match?.[1];
      const file = match?.[2];
      if (!tag || !file || !MIRRORED_DATA_RELEASE_TAG.test(tag) || !file.endsWith('.db.gz'))
        continue;
      const digest = /^sha256:([0-9a-f]{64})$/u.exec(artifact.sha256 ?? '')?.[1];
      if (!digest || !artifact.sizeBytes)
        throw new Error(`Unverifiable mirrored asset ${tag}/${file}`);
      const key = `${tag}/${file}`;
      const line = `${tag}\t${file}\t${artifact.sizeBytes}\t${digest}`;
      if (seen.has(key) && seen.get(key) !== line) throw new Error(`Conflicting asset ${key}`);
      seen.set(key, line);
    }
  }
}
for (const line of seen.values()) console.log(line);
