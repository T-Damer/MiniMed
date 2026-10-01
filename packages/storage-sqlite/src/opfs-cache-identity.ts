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

/**
 * The pool file of a module index that is identified by its own name (version and checksum are in
 * `databaseName`), not by a download size. Imports through a blob: URL cannot learn a size (HEAD is
 * not supported there), so earlier app versions stored them as `/<name>`; a size-qualified
 * `/<name>.<bytes>` exists where a size was known. Both are the same file for this purpose.
 * Returns the installed one, or null when the pool holds neither.
 */
export function findInstalledPackFile(
  databaseName: string,
  byteLength: number,
  installedNames: readonly string[],
): string | null {
  const plain = `/${databaseName}`;
  const sized = `/${databaseName}.${byteLength}`;
  if (installedNames.includes(plain)) return plain;
  if (installedNames.includes(sized)) return sized;
  return null;
}
