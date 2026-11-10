/**
 * The `serverless` mode (ADR-0027): the same HTTP app on Node over YDB, for a Yandex Cloud
 * Serverless Container (it sets PORT; the container's service account signs in through the metadata
 * service, `YDB_METADATA_CREDENTIALS=1`; elsewhere `YDB_ACCESS_TOKEN_CREDENTIALS` works). Bundled
 * with `bun build --target=node`. No live stream (clients poll `/api/changes`), no reminder tick of
 * its own (with `DIARY_TICK_TOKEN` a timer trigger calls `POST /api/tick`) and no static files (the
 * pages live on GitHub Pages).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { toBase64Url } from '@localmed/diary-sync';
import { EnvironCredentialsProvider } from '@ydbjs/auth/environ';
import { Driver } from '@ydbjs/core';

import { createApp } from './app';
import { readSettings } from './config';
import { nodePasswords } from './passwords-node';
import { loadVapid } from './push';
import { YdbStore } from './ydb-store';

const settings = readSettings();
if (settings.mode !== 'serverless' || !settings.ydb) {
  throw new Error('serverless.ts needs DIARY_MODE=serverless and DIARY_YDB');
}
const credentials = new EnvironCredentialsProvider(settings.ydb);
const driver = new Driver(settings.ydb, {
  credentialsProvider: credentials,
  ...(credentials.secureOptions ? { secureOptions: credentials.secureOptions } : {}),
});
await driver.ready();
const store = new YdbStore(driver);
await store.migrate();
let secret = await store.setting('secret');
if (!secret) {
  secret = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  await store.setSetting('secret', secret);
}
const app = createApp(store, {
  mode: 'serverless',
  passwords: nodePasswords,
  signup: settings.signup,
  secret,
  vapid: await loadVapid(store, settings.pushSubject),
  corsOrigins: settings.corsOrigins,
  ...(settings.tickToken ? { tickToken: settings.tickToken } : {}),
  adminEmails: settings.adminEmails,
});

/** Request bodies are small JSON; anything bigger is refused before it is read. */
const MAX_BODY = 2 * 1024 * 1024;

async function toRequest(incoming: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(chunk);
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  const method = incoming.method ?? 'GET';
  return new Request(`http://${headers.get('host') ?? 'diary'}${incoming.url ?? '/'}`, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }),
  });
}

async function send(response: Response, outgoing: ServerResponse): Promise<void> {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => {
    outgoing.setHeader(name, value);
  });
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

const server = createServer((incoming, outgoing) => {
  toRequest(incoming)
    .then(app)
    .then((response) => send(response, outgoing))
    .catch((cause: unknown) => {
      console.error(`request failed: ${cause instanceof Error ? cause.message : 'error'}`);
      if (!outgoing.headersSent) {
        outgoing.statusCode = 400;
        outgoing.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      outgoing.end(JSON.stringify({ error: 'Некорректный запрос.' }));
    });
});
const port = Number(process.env['PORT'] ?? settings.port);
server.listen(port, '0.0.0.0', () =>
  console.info(`diary serverless on :${port} (sign-up: ${settings.signup})`),
);
