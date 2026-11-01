/**
 * Server settings from the environment. Nothing secret is read from here: the decoy-salt secret and
 * the VAPID keys are generated on first start and kept in the database.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface ServerSettings {
  /** ADR-0027: `server` (Bun + SQLite, live stream) or `serverless` (Node + YDB, clients poll). */
  readonly mode: 'server' | 'serverless';
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly signup: 'open' | 'invite';
  readonly staticDir: string | undefined;
  /** VAPID contact (`mailto:` or `https:`), required by push services. */
  readonly pushSubject: string;
  /** Comma-separated origins allowed to call the API cross-origin (Android app). */
  readonly corsOrigins: readonly string[];
  /** `serverless` only: YDB connection string (`grpcs://…?database=…`). */
  readonly ydb: string | undefined;
}

export function readSettings(
  env: Record<string, string | undefined> = process.env,
): ServerSettings {
  const mode = env['DIARY_MODE'] === 'serverless' ? 'serverless' : 'server';
  const database = resolve(env['DIARY_DB'] ?? 'data/diary-server/diary.db');
  if (mode === 'server') mkdirSync(dirname(database), { recursive: true });
  const signup = env['DIARY_SIGNUP'] === 'open' ? 'open' : 'invite';
  return {
    mode,
    host: env['DIARY_HOST'] ?? '127.0.0.1',
    port: Number(env['DIARY_PORT'] ?? 8790),
    database,
    signup,
    staticDir: env['DIARY_STATIC'] ? resolve(env['DIARY_STATIC']) : undefined,
    pushSubject: env['DIARY_PUSH_SUBJECT'] ?? 'mailto:admin@1damer.com',
    corsOrigins: (env['DIARY_CORS_ORIGINS'] ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    ydb: env['DIARY_YDB'],
  };
}
