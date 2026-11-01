import { toBase64Url } from '@localmed/diary-sync';

import { createApp } from './app';
import { readSettings } from './config';
import { bunPasswords } from './passwords';
import { loadVapid } from './push';
import { sendDueReminders } from './reminders';
import { openDatabase, SqliteStore } from './sqlite-store';

/** How often due reminders are looked for; a reminder arrives within this of its moment. */
const REMINDER_TICK_MS = 20_000;

/** The `server` mode (ADR-0027): one Bun process over SQLite; the serverless entry is serverless.ts. */
const settings = readSettings();
if (settings.mode !== 'server')
  throw new Error('main.ts runs the server mode; serverless.ts the other');
const store = new SqliteStore(openDatabase(settings.database));
let secret = await store.setting('secret');
if (!secret) {
  secret = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  await store.setSetting('secret', secret);
}
const vapid = await loadVapid(store, settings.pushSubject);
const app = createApp(store, {
  mode: 'server',
  passwords: bunPasswords,
  signup: settings.signup,
  secret,
  vapid,
  ...(settings.staticDir ? { staticDir: settings.staticDir } : {}),
  corsOrigins: settings.corsOrigins,
});

const server = Bun.serve({
  hostname: settings.host,
  port: settings.port,
  // Live streams stay open; Bun's default idle timeout would cut them.
  idleTimeout: 0,
  fetch: app,
});
console.info(
  `diary server on http://${server.hostname}:${server.port} (sign-up: ${settings.signup}${settings.staticDir ? ', serving the app' : ''})`,
);

setInterval(() => {
  sendDueReminders(store, vapid, (line) => console.info(line)).catch((cause: unknown) =>
    console.error(`reminders failed: ${cause instanceof Error ? cause.name : 'error'}`),
  );
}, REMINDER_TICK_MS);
