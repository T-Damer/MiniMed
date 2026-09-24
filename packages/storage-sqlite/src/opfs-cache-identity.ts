import { opfsVfsFileName } from './opfs-pack';

/** Only checksum-qualified core names can recover a size-suffixed cache without HEAD.
 * Unversioned URLs must never select an arbitrary older database while offline.
 */
export function resolveOpfsCacheFile(
  databaseName: string,
  byteLength: number | null,
  installedNames: readonly string[],
): string {
  const expected = opfsVfsFileName(databaseName, byteLength);
  if (byteLength !== null || installedNames.includes(expected)) return expected;
  if (!/^core\.[a-f0-9]{64}\.db$/u.test(databaseName)) return expected;
  const prefix = `${expected}.`;
  const matches = installedNames.filter((name) => {
    if (!name.startsWith(prefix)) return false;
    const suffix = name.slice(prefix.length);
    const bytes = Number(suffix);
    return /^[1-9]\d*$/u.test(suffix) && Number.isSafeInteger(bytes);
  });
  if (matches.length > 1) throw new Error('Ambiguous cached core edition.');
  return matches[0] ?? expected;
}
