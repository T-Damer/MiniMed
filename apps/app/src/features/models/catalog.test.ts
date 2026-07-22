import { describe, expect, it } from 'vitest';
import { parseLocalModelCatalog } from './catalog';
import rawCatalog from './catalog.preview.json';

describe('local model catalog', () => {
  it('loads the six curated startup candidates', () => {
    const catalog = parseLocalModelCatalog(rawCatalog);
    expect(catalog.models.map((model) => model.id)).toEqual([
      'vikhr-qwen2.5-0.5b-q4',
      'qwen3-0.6b-q8',
      'gemma3-1b-it-q4',
      'qvikhr-3-1.7b-q4',
      'qwen3-1.7b-q8',
      'llama-3.2-3b-instruct-q4',
    ]);
    expect(catalog.models.every((model) => model.artifacts.length > 0)).toBe(true);
  });

  it('includes Russian-first Apache-licensed candidates', () => {
    const catalog = parseLocalModelCatalog(rawCatalog);
    const russian = catalog.models.filter((model) => model.family.includes('vikhr'));
    expect(russian.map((model) => model.id)).toEqual(['vikhr-qwen2.5-0.5b-q4', 'qvikhr-3-1.7b-q4']);
    expect(russian.every((model) => model.license.id === 'apache-2.0')).toBe(true);
    expect(russian.every((model) => model.russianPriority >= 99)).toBe(true);
  });

  it('rejects duplicate model identifiers', () => {
    const duplicate = structuredClone(rawCatalog);
    const firstModel = duplicate.models.at(0);
    const secondModel = duplicate.models.at(1);
    expect(firstModel).toBeDefined();
    expect(secondModel).toBeDefined();
    if (!firstModel || !secondModel) throw new Error('Catalog test requires two model fixtures.');
    secondModel.id = firstModel.id;
    expect(() => parseLocalModelCatalog(duplicate)).toThrow(/повторяющиеся model id/u);
  });

  it('rejects unknown runtimes before they reach the loader', () => {
    const invalid = structuredClone(rawCatalog) as unknown as {
      models: { artifacts: { runtime: string }[] }[];
    };
    const firstModel = invalid.models.at(0);
    const firstArtifact = firstModel?.artifacts.at(0);
    expect(firstArtifact).toBeDefined();
    if (!firstArtifact) throw new Error('Catalog test requires one artifact fixture.');
    firstArtifact.runtime = 'mystery-runtime';
    expect(() => parseLocalModelCatalog(invalid)).toThrow(/неизвестный runtime/u);
  });

  it('keeps license acceptance explicit for gated families', () => {
    const catalog = parseLocalModelCatalog(rawCatalog);
    const gated = catalog.models.filter((model) => model.license.requiresAcceptance);
    expect(gated.map((model) => model.id)).toEqual(['gemma3-1b-it-q4', 'llama-3.2-3b-instruct-q4']);
  });
});
