// With no module installed and no network, the bundled regulatory.db is all the app has of the acts:
// 323-ФЗ must be readable and searchable in full, and every other act must still be found (as a card
// that offers the download). Reads the committed pack, mounted the way the app mounts it.
import { readFile } from 'node:fs/promises';

import { createMedicalCore } from '@localmed/core';
import { PortableHashEmbedder } from '@localmed/search-semantic';
import { MultiMedicalStore } from '@localmed/storage';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { builtInCompanionMounts } from '@/composition/create-browser-core';
import { parseModulePointerMetadata } from '@/features/modules/module-pointer-install';

const BUNDLED = 'apps/app/public/content/regulatory.db';
const MAIN_LAW_ID = 'regulatory.rf.federal-law.323-fz-2011';

let core: ReturnType<typeof createMedicalCore>;

beforeAll(async () => {
  const store = await SqliteMedicalStore.createFromBytes(new Uint8Array(await readFile(BUNDLED)));
  // No installed module: the companion is mounted as the app mounts it at start.
  const mounts = builtInCompanionMounts({ regulatoryStore: store }, new Set());
  expect(mounts.map((mount) => mount.moduleId)).toEqual(['minimed.regulatory.pediatrics.ru']);
  core = createMedicalCore({
    store: new MultiMedicalStore([...mounts]),
    platform: 'test',
    embedder: new PortableHashEmbedder(),
  });
  const ready = await core.initialize();
  if (!ready.ok) throw new Error(ready.error.message);
}, 120_000);

afterAll(async () => {
  await core.close();
});

async function topDocuments(query: string): Promise<readonly string[]> {
  const response = await core.search({
    query,
    mode: 'hybrid',
    filters: {},
    limit: 10,
    includeSuggestions: false,
  });
  if (!response.ok) throw new Error(response.error.message);
  return response.value.groups.map((group) => group.documentId);
}

describe('the regulatory pack bundled in the app, with no module installed', () => {
  it('lists all 31 documents: 323-ФЗ and the crosswalk whole, 29 acts as cards', async () => {
    const listed = await core.listDocuments();
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value).toHaveLength(31);
    const cards = listed.value.filter(
      (document) => parseModulePointerMetadata(document.metadata) !== null,
    );
    expect(cards).toHaveLength(29);
    expect(cards.every((card) => card.sourceType === 'regulatory_act_summary')).toBe(true);
    expect(listed.value.find((document) => document.id === MAIN_LAW_ID)?.title).toContain('323');
  });

  it('opens 323-ФЗ in full text', async () => {
    const law = await core.getDocument(MAIN_LAW_ID);
    if (!law.ok) throw new Error(law.error.message);
    expect(law.value.metadata['contentMode']).toBe('source_text');
    expect(law.value.sections.length).toBeGreaterThan(100);
    const text = law.value.sections.flatMap((section) =>
      section.chunks.map((chunk) => chunk.originalText),
    );
    expect(text.length).toBeGreaterThan(150);
    // Article 20: voluntary informed consent. Present as the law's own words, not a card summary.
    expect(text.join('\n')).toMatch(/добровольное согласие/u);
  });

  it('finds 323-ФЗ by its number and by what it says', async () => {
    expect((await topDocuments('закон 323-ФЗ'))[0]).toBe(MAIN_LAW_ID);
    expect(
      await topDocuments('информированное добровольное согласие на медицинское вмешательство'),
    ).toContain(MAIN_LAW_ID);
    const response = await core.search({
      query: 'право на отказ от медицинского вмешательства',
      mode: 'hybrid',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });
    if (!response.ok) throw new Error(response.error.message);
    const group = response.value.groups.find((item) => item.documentId === MAIN_LAW_ID);
    expect(group?.results.length).toBeGreaterThan(0);
  });

  it('still finds every other act by its number, as a card that names the module', async () => {
    const listed = await core.listDocuments();
    if (!listed.ok) throw new Error(listed.error.message);
    const cards = listed.value.filter(
      (document) => parseModulePointerMetadata(document.metadata) !== null,
    );
    for (const card of cards) {
      const metadata = card.metadata ?? {};
      const number = String(metadata['documentNumber']);
      const kind = number.endsWith('ФЗ') ? 'закон' : 'приказ';
      const found = await topDocuments(`${kind} ${number}`);
      expect(found.slice(0, 2), `${kind} ${number}`).toContain(card.id);
      expect(parseModulePointerMetadata(metadata)?.primaryModuleId).toBe(
        'minimed.regulatory.pediatrics.ru',
      );
    }
  }, 120_000);

  it('finds an act by its topic from the card alone', async () => {
    expect(await topDocuments('порядок диспансерного наблюдения несовершеннолетних')).toContain(
      'regulatory.rf.minzdrav.192n-2025',
    );
    expect(await topDocuments('национальный календарь профилактических прививок')).toContain(
      'regulatory.rf.minzdrav.1122n-2021',
    );
  });
});
