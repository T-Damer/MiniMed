import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/** AGENTS.md «No native pickers»: dates and times go through DateField and the Kobalte TimeField. */
const ROOTS = [join(__dirname, '..'), join(__dirname, '..', '..', 'diary')];
const NATIVE = /type\s*=\s*["'{`]+\s*(date|time|datetime-local|month|week)\s*["'}`]/u;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [path] : [];
  });
}

describe('no native date or time pickers', () => {
  it('finds none in the app or the patient diary', () => {
    const offenders = ROOTS.flatMap(sources).filter((path) =>
      NATIVE.test(readFileSync(path, 'utf8')),
    );
    expect(offenders.map((path) => relative(join(__dirname, '..', '..'), path))).toEqual([]);
  });
});
