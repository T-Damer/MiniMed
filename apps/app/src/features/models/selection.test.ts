import { describe, expect, it } from 'vitest';
import { parseLocalModelCatalog } from './catalog';
import rawCatalog from './catalog.preview.json';
import { buildLocalModelLoadPlan, rankLocalModels, selectLocalModel } from './selection';
import type { LocalModelDeviceProfile, LocalModelPreference } from './types';

const catalog = parseLocalModelCatalog(rawCatalog);

function profile(memory: number | null): LocalModelDeviceProfile {
  return {
    platform: 'browser',
    nativeContainer: false,
    deviceMemoryGb: memory,
    hardwareConcurrency: 8,
    freeStorageBytes: 8_000_000_000,
    webgpu: true,
    saveData: false,
    effectiveConnectionType: '4g',
    automation: false,
    cpuProbeScore: 3000,
    fingerprint: `browser:${memory ?? 'unknown'}`,
  };
}

function preference(overrides: Partial<LocalModelPreference> = {}): LocalModelPreference {
  return {
    automatic: true,
    selectedModelId: null,
    acceptedLicenseIds: [],
    autoLoad: true,
    ...overrides,
  };
}

const runtimes = new Set(['wllama-web'] as const);

describe('local model selection', () => {
  it('chooses the 398 MB Russian Vikhr model on a 4 GB browser device', () => {
    const selected = selectLocalModel({
      models: catalog.models,
      profile: profile(4),
      preference: preference(),
      availableRuntimes: runtimes,
    });
    expect(selected?.model.id).toBe('vikhr-qwen2.5-0.5b-q4');
  });

  it('chooses QVikhr 1.7B on an 8 GB device', () => {
    const selected = selectLocalModel({
      models: catalog.models,
      profile: profile(8),
      preference: preference(),
      availableRuntimes: runtimes,
    });
    expect(selected?.model.id).toBe('qvikhr-3-1.7b-q4');
  });

  it('builds an automatic plan with a genuinely smaller fallback', () => {
    const plan = buildLocalModelLoadPlan({
      models: catalog.models,
      profile: profile(8),
      preference: preference(),
      availableRuntimes: runtimes,
    });
    expect(plan.map((candidate) => candidate.model.id)).toEqual([
      'qvikhr-3-1.7b-q4',
      'vikhr-qwen2.5-0.5b-q4',
    ]);
    expect(plan[1]?.artifact.downloadBytes).toBeLessThan(plan[0]?.artifact.downloadBytes ?? 0);
  });

  it('keeps Gemma available after its terms were accepted', () => {
    const selected = selectLocalModel({
      models: catalog.models,
      profile: profile(8),
      preference: preference({
        automatic: false,
        selectedModelId: 'gemma3-1b-it-q4',
        acceptedLicenseIds: ['gemma-terms'],
      }),
      availableRuntimes: runtimes,
    });
    expect(selected?.model.id).toBe('gemma3-1b-it-q4');
  });

  it('loads a manual override first instead of the automatic winner', () => {
    const plan = buildLocalModelLoadPlan({
      models: catalog.models,
      profile: profile(12),
      preference: preference({
        automatic: false,
        selectedModelId: 'qwen3-1.7b-q8',
      }),
      availableRuntimes: runtimes,
    });
    expect(plan[0]?.model.id).toBe('qwen3-1.7b-q8');
    expect(plan[1]?.artifact.downloadBytes).toBeLessThan(plan[0]?.artifact.downloadBytes ?? 0);
  });

  it('honors a compact manual model override when the artifact is compatible', () => {
    const selected = selectLocalModel({
      models: catalog.models,
      profile: profile(12),
      preference: preference({
        automatic: false,
        selectedModelId: 'qwen3-0.6b-q8',
      }),
      availableRuntimes: runtimes,
    });
    expect(selected?.model.id).toBe('qwen3-0.6b-q8');
  });

  it('does not rank licence-gated or unavailable native-only candidates', () => {
    const ranked = rankLocalModels({
      models: catalog.models,
      profile: profile(16),
      preference: preference(),
      availableRuntimes: runtimes,
    });
    expect(ranked.map((item) => item.model.id)).not.toContain('gemma3-1b-it-q4');
    expect(ranked.map((item) => item.model.id)).not.toContain('llama-3.2-3b-instruct-q4');
  });

  it('rejects candidates when storage cannot hold the artifact and safety margin', () => {
    const lowStorage = { ...profile(8), freeStorageBytes: 300_000_000 };
    const selected = selectLocalModel({
      models: catalog.models,
      profile: lowStorage,
      preference: preference(),
      availableRuntimes: runtimes,
    });
    expect(selected).toBeNull();
  });
});
