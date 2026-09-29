/**
 * Data ledger: re-measures every artifact recorded in docs/data-ledger.json and flags unrecorded
 * artifacts at or above the ledger threshold, so the ledger does not drift from the disk.
 *
 *   bun run data:ledger              report sizes, classes, delete candidates, unknown artifacts
 *   bun run data:ledger -- --write   also store the measured bytes/modified date in the ledger
 *   bun run data:ledger -- --strict  exit 1 when an artifact is unrecorded or a recorded one vanished
 *   bun run data:ledger -- --commands [--tier=confirm]  print rm commands for delete candidates
 *
 * It never deletes anything. Decisions stay with the project owner (docs/DATA_LEDGER.md).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

export type LedgerClass =
  | 'SOURCE'
  | 'RELEASED'
  | 'REBUILDABLE'
  | 'DUPLICATE'
  | 'BACKUP'
  | 'OBSOLETE';

export interface LedgerEntry {
  readonly path: string;
  readonly pattern?: boolean;
  readonly class: LedgerClass;
  readonly producer: string;
  readonly consumers: readonly string[];
  readonly rebuild?: string;
  readonly release?: string;
  readonly note?: string;
  readonly deleteCandidate?: { readonly tier: 'safe' | 'confirm'; readonly reason: string };
  bytes?: number;
  modified?: string;
}

export interface Ledger {
  readonly schemaVersion: 1;
  readonly thresholdBytes: number;
  readonly areas: readonly string[];
  readonly classes: Readonly<Record<LedgerClass, string>>;
  readonly entries: LedgerEntry[];
}

export interface Measurement {
  readonly path: string;
  readonly bytes: number;
  readonly modified: string;
}

const CLASSES: readonly LedgerClass[] = [
  'SOURCE',
  'RELEASED',
  'REBUILDABLE',
  'DUPLICATE',
  'BACKUP',
  'OBSOLETE',
];

export function matchesPattern(pattern: string, path: string): boolean {
  if (dirname(pattern) !== dirname(path)) return false;
  const expression = basename(pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${expression}$`, 'u').test(basename(path));
}

/** True when a path is recorded itself, lies inside a recorded directory, or matches a pattern. */
export function isRecorded(entries: readonly LedgerEntry[], path: string): boolean {
  return entries.some((entry) =>
    entry.pattern
      ? matchesPattern(entry.path, path)
      : path === entry.path || path.startsWith(`${entry.path}/`),
  );
}

/** Bytes of an entry excluding nested recorded entries, so class totals never double count. */
export function ownBytes(
  entry: LedgerEntry,
  measurements: ReadonlyMap<string, Measurement>,
): number {
  const own = measurements.get(entry.path)?.bytes ?? 0;
  let nested = 0;
  for (const [path, measurement] of measurements) {
    if (path !== entry.path && path.startsWith(`${entry.path}/`)) nested += measurement.bytes;
  }
  return Math.max(0, own - nested);
}

function measure(absolute: string): { bytes: number; modifiedMs: number } {
  const stat = lstatSync(absolute);
  if (!stat.isDirectory()) return { bytes: stat.size, modifiedMs: stat.mtimeMs };
  let bytes = 0;
  let modifiedMs = 0;
  for (const name of readdirSync(absolute, { recursive: true }) as string[]) {
    const child = lstatSync(join(absolute, name));
    if (child.isDirectory()) continue;
    bytes += child.size;
    modifiedMs = Math.max(modifiedMs, child.mtimeMs);
  }
  return { bytes, modifiedMs };
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function expand(root: string, entry: LedgerEntry): string[] {
  if (!entry.pattern) return existsSync(resolve(root, entry.path)) ? [entry.path] : [];
  const directory = resolve(root, dirname(entry.path));
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .map((name) => `${dirname(entry.path)}/${name}`)
    .filter((path) => matchesPattern(entry.path, path));
}

export function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0).padStart(7)} MiB`;
}

function shellQuote(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}

function run(): void {
  const args = new Set(process.argv.slice(2));
  const root = resolve(import.meta.dirname, '..');
  const ledgerPath = resolve(root, 'docs/data-ledger.json');
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Ledger;
  const measurements = new Map<string, Measurement>();
  const missing: string[] = [];
  for (const entry of ledger.entries) {
    const paths = expand(root, entry);
    if (paths.length === 0) missing.push(entry.path);
    let bytes = 0;
    let modifiedMs = 0;
    for (const path of paths) {
      const measured = measure(resolve(root, path));
      bytes += measured.bytes;
      modifiedMs = Math.max(modifiedMs, measured.modifiedMs);
    }
    if (paths.length > 0) {
      measurements.set(entry.path, { path: entry.path, bytes, modified: day(modifiedMs) });
    }
  }

  const unknown: Measurement[] = [];
  for (const area of ledger.areas) {
    const absolute = resolve(root, area);
    if (!existsSync(absolute) || isRecorded(ledger.entries, area)) continue;
    for (const name of readdirSync(absolute)) {
      const path = `${area}/${name}`;
      if (isRecorded(ledger.entries, path)) continue;
      const measured = measure(resolve(root, path));
      if (measured.bytes >= ledger.thresholdBytes) {
        unknown.push({ path, bytes: measured.bytes, modified: day(measured.modifiedMs) });
      }
    }
  }

  if (args.has('--commands')) {
    const tiers = new Set(
      [...args].some((arg) => arg === '--tier=confirm') ? ['safe', 'confirm'] : ['safe'],
    );
    for (const entry of ledger.entries) {
      if (!entry.deleteCandidate || !tiers.has(entry.deleteCandidate.tier)) continue;
      if (entry.class === 'SOURCE') throw new Error(`SOURCE cannot be a candidate: ${entry.path}`);
      for (const path of expand(root, entry)) console.log(`rm -rf -- ${shellQuote(path)}`);
    }
    return;
  }

  const byClass = new Map<LedgerClass, { count: number; bytes: number }>();
  const candidates = new Map<string, { count: number; bytes: number }>();
  for (const entry of ledger.entries) {
    if (entry.deleteCandidate && entry.class === 'SOURCE') {
      throw new Error(`SOURCE cannot be a delete candidate: ${entry.path}`);
    }
    const bytes = ownBytes(entry, measurements);
    const total = byClass.get(entry.class) ?? { count: 0, bytes: 0 };
    byClass.set(entry.class, { count: total.count + 1, bytes: total.bytes + bytes });
    if (entry.deleteCandidate && measurements.has(entry.path)) {
      const key = `${entry.class} (${entry.deleteCandidate.tier})`;
      const sum = candidates.get(key) ?? { count: 0, bytes: 0 };
      candidates.set(key, { count: sum.count + 1, bytes: sum.bytes + bytes });
    }
  }

  console.log(`Data ledger ${relative(root, ledgerPath)}: ${ledger.entries.length} entries`);
  console.log('\nBy class (nested entries counted once):');
  for (const name of CLASSES) {
    const total = byClass.get(name) ?? { count: 0, bytes: 0 };
    console.log(`  ${name.padEnd(12)} ${String(total.count).padStart(3)} ${mb(total.bytes)}`);
  }
  console.log('\nDelete candidates (nothing is deleted; see docs/DATA_LEDGER.md):');
  for (const [key, total] of [...candidates].sort()) {
    console.log(`  ${key.padEnd(24)} ${String(total.count).padStart(3)} ${mb(total.bytes)}`);
  }
  console.log('\nLargest candidates:');
  for (const entry of ledger.entries
    .filter((item) => item.deleteCandidate && measurements.has(item.path))
    .sort((a, b) => ownBytes(b, measurements) - ownBytes(a, measurements))
    .slice(0, 15)) {
    console.log(
      `  ${mb(ownBytes(entry, measurements))}  ${entry.class.padEnd(11)} ${entry.deleteCandidate?.tier.padEnd(7)} ${entry.path}`,
    );
  }
  if (missing.length > 0) {
    console.log('\nRecorded but absent (deleted or moved; update the ledger):');
    for (const path of missing) console.log(`  ${path}`);
  }
  if (unknown.length > 0) {
    console.log(
      `\nUnrecorded artifacts >= ${mb(ledger.thresholdBytes).trim()} (add them to the ledger):`,
    );
    for (const item of unknown.sort((a, b) => b.bytes - a.bytes)) {
      console.log(`  ${mb(item.bytes)}  ${item.modified}  ${item.path}`);
    }
  }

  if (args.has('--write')) {
    for (const entry of ledger.entries) {
      const measured = measurements.get(entry.path);
      if (measured) {
        entry.bytes = measured.bytes;
        entry.modified = measured.modified;
      } else {
        delete entry.bytes;
        delete entry.modified;
      }
    }
    // Same formatter as `bun run check`, so a refreshed ledger never fails the lint gate.
    const formatted = execFileSync(
      'bunx',
      ['--no-install', 'biome', 'format', `--stdin-file-path=${relative(root, ledgerPath)}`],
      { cwd: root, input: `${JSON.stringify(ledger, null, 2)}\n`, encoding: 'utf8' },
    );
    writeFileSync(ledgerPath, formatted);
    console.log(`\nUpdated measurements in ${relative(root, ledgerPath)}.`);
  }
  if (args.has('--strict') && (unknown.length > 0 || missing.length > 0)) process.exit(1);
}

if (import.meta.main) run();
