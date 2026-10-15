#!/usr/bin/env bun
/**
 * Puts the KD1 meaning-search query model into the Android build (owner decision 2026-10-15).
 *
 *   bun scripts/fetch-query-model.ts                    # download + verify into the cache only
 *   bun scripts/fetch-query-model.ts --stage android    # ... and stage it in the Android web assets
 *   bun scripts/fetch-query-model.ts --stage-dir <dir>  # ... or in any `public` directory
 *   bun scripts/fetch-query-model.ts --check-apk <apk>  # verify that an APK carries the model
 *
 * The model is never committed. Run the stage step AFTER `cap sync` (it replaces the assets
 * directory); `bun run native:sync:android` does both. Cache: `.cache/localmed/query-model` of the
 * main checkout (shared by its worktrees), or `MINIMED_QUERY_MODEL_CACHE`. Details:
 * docs/SEMANTIC_RETRIEVAL.md «Download».
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import {
  apkModelProblems,
  fetchQueryModel,
  REPOSITORY_ROOT,
  stageQueryModel,
} from './lib/query-model';

const ANDROID_PUBLIC_DIR = join(REPOSITORY_ROOT, 'apps/app/android/app/src/main/assets/public');

/** The main checkout's cache, so every worktree shares one 136 MB copy. */
function defaultCacheDir(): string {
  const override = process.env.MINIMED_QUERY_MODEL_CACHE;
  if (override) return resolve(override);
  const common = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });
  const gitDir = common.status === 0 ? common.stdout.trim() : '';
  const root = gitDir
    ? dirname(isAbsolute(gitDir) ? gitDir : resolve(REPOSITORY_ROOT, gitDir))
    : REPOSITORY_ROOT;
  return join(root, '.cache/localmed/query-model');
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}

async function main(): Promise<void> {
  const apk = option('--check-apk');
  if (apk) {
    const listing = spawnSync('unzip', ['-l', apk], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    // Info-ZIP exits 1 on warnings (aligned APKs) with a complete listing.
    if (listing.error || (listing.status ?? 2) > 1) {
      throw new Error(`unzip -l ${apk} failed: ${listing.error ?? listing.stderr}`);
    }
    const problems = apkModelProblems(listing.stdout);
    if (problems.length > 0)
      throw new Error(`The APK does not carry the query model:\n${problems.join('\n')}`);
    console.log('APK carries the query model with the pinned sizes.');
    return;
  }

  const cacheDir = defaultCacheDir();
  const log = (line: string): void => console.log(`query model: ${line}`);
  await fetchQueryModel({ cacheDir, log });

  const stage = option('--stage');
  const stageDir = option('--stage-dir');
  if (stage && stage !== 'android')
    throw new Error('--stage supports only "android"; use --stage-dir');
  const publicDir = stageDir ? resolve(stageDir) : stage ? ANDROID_PUBLIC_DIR : undefined;
  if (!publicDir) return;
  if (!stageDir && !existsSync(publicDir)) {
    throw new Error(
      `${publicDir} does not exist: run \`cap sync\` first (it creates the web assets).`,
    );
  }
  log(`staged in ${stageQueryModel({ cacheDir, publicDir })}`);
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
