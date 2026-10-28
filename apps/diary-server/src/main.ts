import { toBase64Url } from '@localmed/diary-sync';

import { createApp } from './app';
import { readSettings } from './config';
import { openDatabase, setSetting, setting } from './db';
import { loadVapid } from './push';
import { sendDueReminders } from './reminders';

/** How often due reminders are looked for; a reminder arrives within this of its moment. */
const REMINDER_TICK_MS = 20_000;

const settings = readSettings();
const db = openDatabase(settings.database);
let secret = setting(db, 'secret');
if (!secret) {
  secret = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  setSetting(db, 'secret', secret);
}
const vapid = await loadVapid(db, settings.pushSubject);
const app = createApp(db, {
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
  try {
    sendDueReminders(db, vapid, (line) => console.info(line));
  } catch (cause) {
    console.error(`reminders failed: ${cause instanceof Error ? cause.name : 'error'}`);
  }
}, REMINDER_TICK_MS);
