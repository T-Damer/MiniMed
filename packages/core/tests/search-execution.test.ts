import type { LexicalHit, LexicalSearchRequest } from '@localmed/storage';
import { InMemoryMedicalStore } from '@localmed/storage';
import { DEMO_CONTENT_PACK } from '@localmed/test-fixtures';
import { expect, it } from 'vitest';

import { createMedicalCore } from '../src/create-medical-core';

class ObservedStore extends InMemoryMedicalStore {
  public aliasReads = 0;
  public searchCalls = 0;
  public maxConcurrentSearches = 0;
  private concurrentSearches = 0;

  public override async listAliases() {
    this.aliasReads += 1;
    return super.listAliases();
  }

  public override async search(request: LexicalSearchRequest): Promise<readonly LexicalHit[]> {
    this.searchCalls += 1;
    this.concurrentSearches += 1;
    this.maxConcurrentSearches = Math.max(this.maxConcurrentSearches, this.concurrentSearches);
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      return await super.search(request);
    } finally {
      this.concurrentSearches -= 1;
    }
  }
}

it('caches aliases and runs independent lexical branches concurrently', async () => {
  const store = new ObservedStore();
  const core = createMedicalCore({ store, seed: DEMO_CONTENT_PACK, platform: 'test' });
  await core.initialize();

  const query = 'ребенок 3 года температура 39 кашель одышка анализ крови';
  await core.analyzeQuery({ query, includeSuggestions: false });
  const result = await core.search({
    query,
    mode: 'lexical',
    filters: {},
    limit: 5,
    includeSuggestions: false,
  });

  expect(result.ok).toBe(true);
  expect(store.aliasReads).toBe(1);
  expect(store.searchCalls).toBeGreaterThan(1);
  expect(store.maxConcurrentSearches).toBeGreaterThan(1);
  await core.close();
});
