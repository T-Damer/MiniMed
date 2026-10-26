import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Owner 2026-10-26 (QA item 13 follow-up): a screen that is still loading shows its chrome and a
// skeleton, never a lone spinner. The e2e `no-bare-loader.spec.ts` watches real flows frame by
// frame; these checks keep the code that draws whole screens on the shared skeleton.

const SOURCE = resolve(import.meta.dirname, '..');

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx|ts|css)$/u.test(name) && !name.includes('.test.') ? [path] : [];
  });
}

/** The `fallback={…}` of every `<Suspense` in a file, as source text. */
function suspenseFallbacks(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/<Suspense\b/gu)) {
    const rest = text.slice(match.index);
    const open = rest.indexOf('>');
    const fallback = rest.indexOf('fallback={');
    if (fallback === -1 || fallback > open + 400) {
      found.push('');
      continue;
    }
    let depth = 0;
    let end = fallback + 'fallback='.length;
    for (; end < rest.length; end += 1) {
      if (rest[end] === '{') depth += 1;
      if (rest[end] === '}') depth -= 1;
      if (depth === 0) break;
    }
    found.push(rest.slice(fallback, end + 1));
  }
  return found;
}

describe('loading screens', () => {
  it('draw whole screens with the shared skeleton', () => {
    for (const file of ['app/App.tsx', 'features/notes/NotesView.tsx']) {
      const text = readFileSync(join(SOURCE, file), 'utf8');
      const screens = suspenseFallbacks(text).filter((fallback) => fallback !== '');
      expect(screens.length, file).toBeGreaterThan(0);
      for (const fallback of screens) {
        expect(fallback, `${file}: ${fallback.slice(0, 80)}`).toContain('<PageSkeleton');
      }
    }
  });

  it('keep the reader free of the old full-size ring', () => {
    const offenders = sources(SOURCE)
      .filter((path) => readFileSync(path, 'utf8').includes('document-overlay-spinner'))
      .map((path) => relative(SOURCE, path));
    expect(offenders).toEqual([]);
  });

  it('show pending text in the reader as skeleton lines', () => {
    const reader = readFileSync(
      join(SOURCE, 'features/library/OfficialDocumentReader.tsx'),
      'utf8',
    );
    const pending = [...reader.matchAll(/document-overlay-paper__pending/gu)].length;
    const lines = [...reader.matchAll(/<SkeletonLines\b/gu)].length;
    expect(pending).toBeGreaterThan(0);
    expect(lines).toBeGreaterThanOrEqual(pending);
  });
});
