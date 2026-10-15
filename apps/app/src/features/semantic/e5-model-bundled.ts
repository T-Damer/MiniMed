import { E5_MODEL_FILES } from './e5-model';

/**
 * Reads one pinned file of the query model from the copy bundled in the Android web assets. Safe
 * for the search worker: no Capacitor import, the caller passes the absolute base URL it resolved
 * on the main thread (a worker resolves relative URLs against its own script, not the document).
 *
 * The bytes are trusted as part of the signed APK: `scripts/fetch-query-model.ts` verified every
 * SHA-256 before staging, and Android refuses to install an APK whose files were altered. A size
 * check remains, because it is free and catches a truncated asset.
 */
export async function readBundledE5ModelFile(baseUrl: string, path: string): Promise<Blob | null> {
  const file = E5_MODEL_FILES.find((candidate) => candidate.path === path);
  if (!file) return null;
  const response = await fetch(new URL(path, baseUrl));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('semantic-bundled-model-unreadable');
  const data = await response.blob();
  if (data.size !== file.sizeBytes) throw new Error('semantic-bundled-model-invalid');
  return data;
}
