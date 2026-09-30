import { CoreIdentityHitSchema } from '@localmed/contracts';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';
import { CORE_SLICE_PACK } from '@localmed/test-fixtures';
import type { Database } from '@sqlite.org/sqlite-wasm';
import { expect, it } from 'vitest';

it('reads exact source identities without FTS, preserves meanings and rejects malformed targets', async () => {
  const store = await SqliteMedicalStore.create();
  try {
    await store.initialize(CORE_SLICE_PACK);
    const db = (store as unknown as { readonly database: Database }).database;
    const initialChunks = db.selectValue('SELECT count(*) FROM chunks');
    for (const entityId of ['one', 'two']) {
      const target = {
        type: 'definition',
        moduleId: 'reference',
        moduleVersion: '1',
        editionId: 'edition',
        entityId,
      };
      db.exec({
        sql: 'INSERT INTO core_identity_targets VALUES (?, ?, ?, ?, ?, ?)',
        bind: [
          entityId,
          'reference',
          entityId,
          'abbreviation',
          'needs-definition',
          JSON.stringify(target),
        ],
      });
      db.exec({
        sql: 'INSERT INTO core_identities VALUES (?, ?, ?, ?)',
        bind: ['на', 'НА', entityId, 'reference'],
      });
    }
    expect(
      (await store.lookupCoreIdentities('  НА  ')).map(
        (hit) => CoreIdentityHitSchema.parse(hit).target,
      ),
    ).toHaveLength(2);
    expect(await store.lookupCoreIdentities('Н')).toEqual([]);
    expect(db.selectValue('SELECT count(*) FROM chunks')).toBe(initialChunks);
    db.exec("UPDATE core_identity_targets SET target_json='{}' WHERE target_id='one'");
    await expect(store.lookupCoreIdentities('на')).rejects.toThrow();
    db.exec('DROP TABLE core_identities');
    expect(await store.lookupCoreIdentities('НА')).toEqual([]);
  } finally {
    await store.close();
  }
});
