import { toBase64Url } from '@localmed/diary-sync';

import { createApp } from './app';
import { readSettings } from './config';
import { openDatabase, setSetting, setting } from './db';
import { loadVapid } from './push';

const settings = readSettings();
const db = openDatabase(settings.database);
let secret = setting(db, 'secret');
if (!secret) {
  secret = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  setSetting(db, 'secret', secret);
}
const app = createApp(db, {
  signup: settings.signup,
  secret,
  vapid: await loadVapid(db, settings.pushSubject),
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
