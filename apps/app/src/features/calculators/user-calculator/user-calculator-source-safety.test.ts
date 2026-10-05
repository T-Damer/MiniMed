import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_SRC = resolve(import.meta.dirname, '../../..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/u.test(entry) && !/\.test\.tsx?$/u.test(entry) ? [path] : [];
  });
}

describe('calculator source never runs text as code', () => {
  // The forbidden words are spelled in pieces so this file does not trip the check on itself.
  const forbidden = new RegExp(
    `\\b${'ev'}al\\s*\\(|new\\s+${'Func'}tion\\b|\\b${'Func'}tion\\s*\\(`,
    'u',
  );
  const files = [
    ...sourceFiles(join(APP_SRC, 'features/calculators')),
    ...readdirSync(join(APP_SRC, 'state'))
      .filter((name) => /^user-calculators.*\.ts$/u.test(name) && !name.endsWith('.test.ts'))
      .map((name) => join(APP_SRC, 'state', name)),
  ];

  it('looks at the calculator engine, the builder and the stored model', () => {
    const names = files.map((file) => relative(APP_SRC, file));
    expect(names).toContain('features/calculators/calculator-expression.ts');
    expect(names).toContain('features/calculators/user-calculator/user-formula.ts');
    expect(names).toContain('state/user-calculators.ts');
  });

  it.each(files.map((file) => [relative(APP_SRC, file), file] as const))(
    '%s has no dynamic code evaluation',
    (_name, file) => {
      const text = readFileSync(file, 'utf8');
      expect(forbidden.test(text)).toBe(false);
      expect(/\bnew\s+Function\b|\bFunction\(/u.test(text)).toBe(false);
    },
  );
});
