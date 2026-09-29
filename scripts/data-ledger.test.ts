import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  isRecorded,
  type Ledger,
  type LedgerEntry,
  type Measurement,
  matchesPattern,
  ownBytes,
} from './data-ledger';

const entry = (path: string, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  path,
  class: 'REBUILDABLE',
  producer: 'test',
  consumers: [],
  ...extra,
});

describe('data ledger', () => {
  it('treats children of a recorded directory and pattern matches as recorded', () => {
    const entries = [entry('data/build/release'), entry('data/build/pack-*.db', { pattern: true })];
    expect(isRecorded(entries, 'data/build/release/a.zip')).toBe(true);
    expect(isRecorded(entries, 'data/build/pack-one.db')).toBe(true);
    expect(isRecorded(entries, 'data/build/pack-one.db.gz')).toBe(false);
    expect(isRecorded(entries, 'data/build/releases')).toBe(false);
    expect(matchesPattern('data/build/pack-*.db', 'data/other/pack-one.db')).toBe(false);
  });

  it('subtracts nested recorded entries from a directory total', () => {
    const measurements = new Map<string, Measurement>([
      ['data/build/module', { path: 'data/build/module', bytes: 900, modified: '2026-09-28' }],
      [
        'data/build/module/intermediate.db',
        { path: 'data/build/module/intermediate.db', bytes: 300, modified: '2026-09-28' },
      ],
    ]);
    expect(ownBytes(entry('data/build/module'), measurements)).toBe(600);
    expect(ownBytes(entry('data/build/module/intermediate.db'), measurements)).toBe(300);
  });

  it('never proposes a SOURCE artifact for deletion', () => {
    const ledger = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../docs/data-ledger.json'), 'utf8'),
    ) as Ledger;
    const sources = ledger.entries.filter((item) => item.class === 'SOURCE');
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((item) => item.deleteCandidate)).toEqual([]);
    expect(
      ledger.entries.filter((item) => item.path.startsWith('data/raw/') && item.class !== 'SOURCE'),
    ).toEqual([]);
  });
});
