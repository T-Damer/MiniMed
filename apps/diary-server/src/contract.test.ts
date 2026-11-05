import { describe, expect, it } from 'bun:test';

import { createApp, type DiaryMode } from './app';
import { CONTRACT_TICK_TOKEN, runStoreContract } from './contract';
import { bunPasswords } from './passwords';
import { loadVapid } from './push';
import { openDatabase, SqliteStore } from './sqlite-store';

describe('storage port contract over SQLite', () => {
  for (const mode of ['server', 'serverless'] satisfies DiaryMode[]) {
    it(`runs a whole diary life in ${mode} mode`, async () => {
      const store = new SqliteStore(openDatabase(':memory:'));
      const app = createApp(store, {
        mode,
        passwords: bunPasswords,
        signup: 'open',
        secret: 'test-secret',
        vapid: await loadVapid(store, 'mailto:test@example.org'),
        tickToken: CONTRACT_TICK_TOKEN,
        log: () => undefined,
      });
      expect((await runStoreContract(app, mode, store)).length).toBe(11);
    });
  }
});
