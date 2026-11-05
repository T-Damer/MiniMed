/**
 * Runs the storage contract (contract.ts) on Node over a real YDB database: what
 * `scripts/diary-ydb-contract.sh` bundles. Needs DIARY_YDB and YDB credentials in the environment
 * (YDB_ACCESS_TOKEN_CREDENTIALS from `yc iam create-token`). Use a database of its own: each run
 * leaves its rows (unique e-mails and ids per run).
 */
import { EnvironCredentialsProvider } from '@ydbjs/auth/environ';
import { Driver } from '@ydbjs/core';

import { createApp } from './app';
import { CONTRACT_TICK_TOKEN, runStoreContract } from './contract';
import { nodePasswords } from './passwords-node';
import { loadVapid } from './push';
import { YdbStore } from './ydb-store';

const connection = process.env['DIARY_YDB'];
if (!connection) throw new Error('DIARY_YDB is required');
const credentials = new EnvironCredentialsProvider(connection);
const driver = new Driver(connection, {
  credentialsProvider: credentials,
  ...(credentials.secureOptions ? { secureOptions: credentials.secureOptions } : {}),
});
await driver.ready();
const store = new YdbStore(driver);
const started = performance.now();
await store.migrate();
const app = createApp(store, {
  mode: 'serverless',
  passwords: nodePasswords,
  signup: 'open',
  secret: 'contract-secret',
  vapid: await loadVapid(store, 'mailto:test@example.org'),
  tickToken: CONTRACT_TICK_TOKEN,
  log: (line) => {
    if (line.includes(' 500 ') || line.startsWith('error')) console.error(line);
  },
});
try {
  for (const step of await runStoreContract(app, 'serverless', store)) console.info(`ok  ${step}`);
  console.info(`contract passed on YDB in ${Math.round(performance.now() - started)} ms`);
} finally {
  await driver.close();
}
