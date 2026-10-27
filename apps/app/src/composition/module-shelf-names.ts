/**
 * The shelf is split into shards: each is one SAH pool with its own worker, so a search that asks
 * every installed module runs on several threads at once (one worker ran 774 modules one after
 * another). Fixed, not taken from the device: a file's shard follows from its name, and a smaller
 * count would leave the files of the dropped shards unreachable.
 */
export const SHELF_SHARD_COUNT = 3;

/** The SAH pool of a shard; shard 0 keeps the name of the single pool earlier apps wrote. */
export function shelfPoolName(shard: number): string {
  return shard === 0 ? 'minimed-shelf' : `minimed-shelf-${shard}`;
}

/** The shard a module file lives in: FNV-1a of its name, so placement needs no lookup table. */
export function shelfShardOf(file: string, shardCount: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < file.length; index += 1) {
    hash ^= file.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % shardCount;
}
/**
 * Memory the page caches of all shelf connections may fill together, in KiB, when the device does
 * not say how much memory it has. SQLite offers no global limit, so every connection gets an equal
 * share of it when the library is mounted, never less than `SHELF_CACHE_MIN_KIB`: past a thousand
 * modules the floor decides, 256 KiB each.
 */
export const SHELF_CACHE_BUDGET_KIB = 256 * 1024;
const SHELF_CACHE_MIN_KIB = 256;
const SHELF_CACHE_MAX_KIB = 4096;
/** A search reads a few hundred pages per module; a smaller cache re-reads them inside one query. */
const BUDGET_KIB_PER_DEVICE_GB = 48 * 1024;
const BUDGET_MIN_KIB = 96 * 1024;
const BUDGET_MAX_KIB = 384 * 1024;

/**
 * The page-cache budget for this device: a share of its memory (`navigator.deviceMemory`, in GB,
 * where the browser reports it), 96 MiB on a 2 GB phone and 384 MiB from 8 GB.
 */
export function shelfCacheBudgetKiB(deviceMemoryGb: number | undefined): number {
  if (deviceMemoryGb === undefined || !Number.isFinite(deviceMemoryGb) || deviceMemoryGb <= 0) {
    return SHELF_CACHE_BUDGET_KIB;
  }
  return Math.min(
    BUDGET_MAX_KIB,
    Math.max(BUDGET_MIN_KIB, Math.round(deviceMemoryGb * BUDGET_KIB_PER_DEVICE_GB)),
  );
}

/**
 * `PRAGMA cache_size` (negative KiB) of one shelf connection when `moduleCount` modules are
 * mounted: a small library keeps whole modules cached (as fast as in memory), a large one shares
 * the budget, so the cache of the shelf is bounded by the budget (or the floor), not by how much
 * of each module a search has read.
 */
export function shelfCacheKiB(moduleCount: number, budgetKiB = SHELF_CACHE_BUDGET_KIB): number {
  const share = Math.floor(budgetKiB / Math.max(1, moduleCount));
  return -Math.min(SHELF_CACHE_MAX_KIB, Math.max(SHELF_CACHE_MIN_KIB, share));
}

/** Page cache of the connection `put` opens once to check a written file, then closes. */
export const SHELF_VERIFY_CACHE_KIB = -256;
/** Pool slots added at once; a full install adds several hundred files. */
export const SHELF_POOL_GROWTH_STEP = 64;

const FILE_SUFFIX = /\.db(?:\.\d+)?$/u;

/**
 * The shelf file of a module index: the version key (`moduleId@version`, plus the index checksum
 * when the catalog has one), URI-encoded so a file name never carries a path separator.
 */
export function shelfFileName(versionKey: string, indexSha256?: string): string {
  const identity = indexSha256 ? `${versionKey}:${indexSha256}` : versionKey;
  return `${encodeURIComponent(identity)}.db`;
}

/** The module version key a shelf file was written for, or null for a name that is no module file. */
export function shelfFileVersionKey(fileName: string): string | null {
  const name = fileName.startsWith('/') ? fileName.slice(1) : fileName;
  if (!FILE_SUFFIX.test(name)) return null;
  const identity = decodeURIComponent(name.replace(FILE_SUFFIX, ''));
  const checksumAt = identity.indexOf(':sha256:');
  return checksumAt === -1 ? identity : identity.slice(0, checksumAt);
}

/**
 * Whether a pool file is an orphan: a module file no stored version refers to. Names that are not
 * module files (a journal beside an open database) are never orphans, so a sweep cannot take a
 * file a connection is using.
 */
export function isOrphanedShelfFile(
  fileName: string,
  referencedVersionKeys: ReadonlySet<string>,
): boolean {
  const versionKey = shelfFileVersionKey(fileName);
  return versionKey !== null && !referencedVersionKeys.has(versionKey);
}
