import { describe, expect, it } from 'vitest';

import rawCatalog from './catalog.preview.json';
import { parseLocalModelCatalog } from './catalog';

describe('local model catalog', () => {
  it('loads the four curated startup candidates', () => {
    const catalog = parseLocalModelCatalog(rawCatalog);
    expect(catalog.models.map((model) => model.id)).toEqual([
      'qwen3-0.6b-q8',
      'gemma3-1b-it-q4',
      'qwen3-1.7b-q8',
      'llama-3.2-3b-instruct-q4',
    ]);
    expect(catalog.models.every((model) => model.artifacts.length > 0)).toBe(true);
  });

  it('rejects duplicate model identifiers', () => {
    const duplicate = structuredClone(rawCatalog);
    duplicate.models[1].id = duplicate.models[0].id;
    expect(() => parseLocalModelCatalog(duplicate)).toThrow(/повторяющиеся model id/u);
  });

  it('rejects unknown runtimes before they reach the loader', () => {
    const invalid = structuredClone(rawCatalog) as unknown as {
      models: { artifacts: { runtime: string }[] }[];
    };
    invalid.models[0].artifacts[0].runtime = 'mystery-runtime';
    expect(() => parseLocalModelCatalog(invalid)).toThrow(/неизвестный runtime/u);
  });

  it('keeps license acceptance explicit for gated families', () => {
    const catalog = parseLocalModelCatalog(rawCatalog);
    const gated = catalog.models.filter((model) => model.license.requiresAcceptance);
    expect(gated.map((model) => model.id)).toEqual([
      'gemma3-1b-it-q4',
      'llama-3.2-3b-instruct-q4',
    ]);
  });
});
