import { readFileSync } from 'node:fs';
import { MultiMedicalStore } from '@localmed/storage';
import { SqliteMedicalStore } from '@localmed/storage-sqlite';
import { DEMO_CONTENT_PACK } from '@localmed/test-fixtures';
import { describe, expect, it } from 'vitest';

import { createMedicalCore } from '../src/create-medical-core';
import { createInMemoryMedicalCore } from '../src/in-memory';

const PUBLIC_PILOT_DATABASE = 'packages/test-fixtures/data/rf-public-pilot.db';
const RESPIRATORY_DATABASE =
  'apps/app/public/content/modules/minimed-respiratory-pediatrics-full-0.3.4-preview.1.db';

describe('search-context', () => {
  it('remaps a stale full-text hit to the pilot summary when only the summary pack is mounted', async () => {
    const coreBytes = readFileSync(PUBLIC_PILOT_DATABASE);
    const fullBytes = readFileSync(RESPIRATORY_DATABASE);
    const coreStore = await SqliteMedicalStore.createFromBytes(new Uint8Array(coreBytes));
    const fullStore = await SqliteMedicalStore.createFromBytes(new Uint8Array(fullBytes));
    const multi = new MultiMedicalStore([
      { moduleId: 'minimed.core.ru', store: coreStore, required: true, searchWeight: 1.1 },
      { moduleId: 'respiratory', store: fullStore, searchWeight: 1 },
    ]);
    const core = createMedicalCore({ store: multi, platform: 'test' });
    await core.initialize();

    const search = await core.search({
      query: 'пневмония лихорадка',
      mode: 'lexical',
      filters: {},
      limit: 10,
      includeSuggestions: false,
    });
    if (!search.ok) throw new Error(search.error.message);
    const fullHit = search.value.groups
      .flatMap((group) => group.results)
      .find((result) => result.documentId === 'kr.rf.714_2.pneumonia.full');
    if (!fullHit) throw new Error('Expected a full-text pneumonia hit.');

    const summaryOnly = new MultiMedicalStore([
      {
        moduleId: 'minimed.core.ru',
        store: await SqliteMedicalStore.createFromBytes(new Uint8Array(coreBytes)),
        required: true,
        searchWeight: 1.1,
      },
    ]);
    const summaryCore = createMedicalCore({ store: summaryOnly, platform: 'test' });
    await summaryCore.initialize();

    const resolved = await summaryCore.getSearchResultContext(fullHit, 2);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.document.id).toBe('kr.rf.714_2.pneumonia');
      expect(resolved.value.section.sectionType).toBe('clinical-picture');
    }

    await core.close();
    await summaryCore.close();
  });

  it('returns a user-facing message when the chunk cannot be remapped', async () => {
    const coreBytes = readFileSync(PUBLIC_PILOT_DATABASE);
    const demoStore = await SqliteMedicalStore.createFromBytes(new Uint8Array(coreBytes));
    const demoCore = createMedicalCore({ store: demoStore, platform: 'test' });
    await demoCore.initialize();
    const search = await demoCore.search({
      query: 'пневмония лихорадка',
      mode: 'lexical',
      filters: {},
      limit: 5,
      includeSuggestions: false,
    });
    const hit = search.value?.groups.flatMap((group) => group.results)[0];
    if (!hit) throw new Error('Expected a pneumonia search hit.');

    const seedCore = createInMemoryMedicalCore(DEMO_CONTENT_PACK);
    await seedCore.initialize();
    const resolved = await seedCore.getSearchResultContext(hit, 1);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.error.message).toContain('пока недоступен');
    }

    await demoCore.close();
    await seedCore.close();
  });

  it('hides superseded pilot summaries from search when full packs are installed', async () => {
    const coreBytes = readFileSync(PUBLIC_PILOT_DATABASE);
    const fullBytes = readFileSync(RESPIRATORY_DATABASE);
    const multi = new MultiMedicalStore([
      {
        moduleId: 'minimed.core.ru',
        store: await SqliteMedicalStore.createFromBytes(new Uint8Array(coreBytes)),
        required: true,
        searchWeight: 1.1,
      },
      {
        moduleId: 'respiratory',
        store: await SqliteMedicalStore.createFromBytes(new Uint8Array(fullBytes)),
        searchWeight: 1,
      },
    ]);
    const core = createMedicalCore({ store: multi, platform: 'test' });
    await core.initialize();
    const response = await core.search({
      query: 'пневмония лихорадка',
      mode: 'lexical',
      filters: {},
      limit: 20,
      includeSuggestions: false,
    });
    if (!response.ok) throw new Error(response.error.message);
    const documentIds = response.value.groups.map((group) => group.documentId);
    expect(documentIds).toContain('kr.rf.714_2.pneumonia.full');
    expect(documentIds).not.toContain('kr.rf.714_2.pneumonia');
    await core.close();
  });
});
