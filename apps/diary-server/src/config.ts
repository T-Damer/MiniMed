/**
 * Server settings from the environment. The decoy-salt secret and the VAPID keys are generated on
 * first start and kept in the database; the only secret read here is the optional tick token.
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
  /** Origins (separated by commas or semicolons) allowed to call the API cross-origin (Android app). */
  readonly corsOrigins: readonly string[];
  /** `serverless` only: YDB connection string (`grpcs://…?database=…`). */
  readonly ydb: string | undefined;
  /** `POST /api/tick` key for an outside scheduler (a timer trigger in `serverless` mode); none: no route. */
  readonly tickToken: string | undefined;
  /** E-mails (lower case) of the service owner(s) who may open `GET /api/admin/stats`; none: nobody. */
  readonly adminEmails: readonly string[];
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
      // Commas or semicolons: `yc … --environment` takes commas between variables.
      .split(/[,;]/u)
      .map((origin) => origin.trim())
      .filter(Boolean),
    ydb: env['DIARY_YDB'],
    tickToken: env['DIARY_TICK_TOKEN'] || undefined,
    adminEmails: (env['DIARY_ADMIN_EMAILS'] ?? '')
      .split(/[,;]/u)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  };
}
