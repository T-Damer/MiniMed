import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';

import {
  OCR_LANGUAGE_PACK_FILES,
  type OcrLanguage,
} from '../src/features/ocr/ocr-language-pack-catalog';

/**
 * The OCR language pack is not in the build any more: the app downloads it on demand from the
 * pinned upstream. Specs never reach the real CDN while running; they serve the same bytes from a
 * checksum-verified local cache, which is filled once from the catalog's first source.
 */
const CACHE_DIR = resolve(import.meta.dirname, '../../../node_modules/.cache/minimed-e2e/tessdata');

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export async function ensureOcrLanguagePackFixtures(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  for (const file of OCR_LANGUAGE_PACK_FILES) {
    const path = join(CACHE_DIR, `${file.language}.traineddata.gz`);
    if (existsSync(path) && sha256(readFileSync(path)) === file.sha256) continue;
    const source = file.sources[0];
    if (!source) throw new Error(`No source for ${file.language}.`);
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Fixture download failed: HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (sha256(bytes) !== file.sha256) {
      throw new Error(`Fixture ${file.language} does not match the catalog checksum.`);
    }
    const temporary = `${path}.part`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, path);
  }
}

export interface OcrLanguagePackRoutes {
  /** Requests that reached any language-file source, per language. */
  readonly requests: OcrLanguage[];
  /** From now on answer every source with this HTTP status instead of the bytes. */
  failWith(status: number | null): void;
}

const SOURCE_PATTERN =
  /\/(?:naptha\/tessdata@|naptha\/tessdata\/)[0-9a-f]{40}\/4\.0\.0\/(eng|rus)\.traineddata\.gz/u;

/** Serves the language-pack URLs (every mirror) from the local cache and counts the requests. */
export async function routeOcrLanguagePack(page: Page): Promise<OcrLanguagePackRoutes> {
  await ensureOcrLanguagePackFixtures();
  const requests: OcrLanguage[] = [];
  let failure: number | null = null;
  const handler = async (route: import('@playwright/test').Route): Promise<void> => {
    const match = SOURCE_PATTERN.exec(route.request().url());
    const language = match?.[1] as OcrLanguage | undefined;
    if (!language) {
      await route.abort();
      return;
    }
    requests.push(language);
    if (failure !== null) {
      await route.fulfill({
        status: failure,
        headers: { 'access-control-allow-origin': '*' },
        body: '',
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/gzip',
      headers: { 'access-control-allow-origin': '*' },
      body: readFileSync(join(CACHE_DIR, `${language}.traineddata.gz`)),
    });
  };
  await page.route('https://cdn.jsdelivr.net/gh/naptha/tessdata@*/**', handler);
  await page.route('https://raw.githubusercontent.com/naptha/tessdata/**', handler);
  return {
    requests,
    failWith: (status) => {
      failure = status;
    },
  };
}
