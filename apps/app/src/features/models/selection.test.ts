import { describe, expect, it } from 'vitest';
import { parseLocalModelCatalog } from '@/features/models/catalog';
import rawCatalog from '@/features/models/catalog.preview.json';
import {
  buildLocalModelLoadPlan,
  rankLocalModels,
  selectLocalModel,
} from '@/features/models/selection';
import type {
  LocalModelDescriptor,
  LocalModelDeviceProfile,
  LocalModelPreference,
} from '@/features/models/types';

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

// The bundled catalog only offers Apache-2.0 models with a published wllama-web artifact, so
// license-gating and native-only-unavailable behavior are exercised via synthetic fixtures instead
// of a real catalog entry.
function gatedUnpublishedModel(): LocalModelDescriptor {
  return {
    id: 'gated-unpublished-fixture',
    name: 'Gated Fixture Model',
    family: 'fixture',
    tier: 'balanced',
    description: 'Test fixture for a license-gated model with no published artifact.',
    parameterCount: 1_000_000_000,
    qualityScore: 70,
    russianPriority: 50,
    minimumMemoryGb: 4,
    recommendedMemoryGb: 6,
    license: {
      id: 'fixture-terms',
      name: 'Fixture Terms',
      url: 'https://example.com/terms',
      requiresAcceptance: true,
    },
    artifacts: [
      {
        id: 'gated-unpublished-fixture-gguf',
        runtime: 'wllama-web',
        platforms: ['browser', 'android'],
        upstreamUrl: 'https://huggingface.co/fixture/gated-unpublished.gguf',
        mirrorPath: 'gated-unpublished-fixture.gguf',
        downloadBytes: 500_000_000,
        sha256: null,
        published: false,
        maxContextTokens: 2048,
      },
    ],
  };
}

function nativeOnlyUnavailableModel(): LocalModelDescriptor {
  return {
    id: 'native-only-fixture',
    name: 'Native Only Fixture Model',
    family: 'fixture',
    tier: 'balanced',
    description: 'Test fixture whose only artifact needs a runtime not in availableRuntimes.',
    parameterCount: 1_000_000_000,
    qualityScore: 70,
    russianPriority: 50,
    minimumMemoryGb: 4,
    recommendedMemoryGb: 6,
    license: {
      id: 'apache-2.0',
      name: 'Apache License 2.0',
      url: 'https://www.apache.org/licenses/LICENSE-2.0',
      requiresAcceptance: false,
    },
    artifacts: [
      {
        id: 'native-only-fixture-litert',
        runtime: 'litert-native',
        platforms: ['android'],
        upstreamUrl: 'https://huggingface.co/fixture/native-only.litertlm',
        mirrorPath: 'native-only-fixture.litertlm',
        downloadBytes: 500_000_000,
        sha256: null,
        published: true,
        maxContextTokens: 2048,
      },
    ],
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

  it('does not offer a gated model merely because its terms were accepted before a mirror is published', () => {
    const selected = selectLocalModel({
      models: [...catalog.models, gatedUnpublishedModel()],
      profile: profile(8),
      preference: preference({
        automatic: false,
        selectedModelId: 'gated-unpublished-fixture',
        acceptedLicenseIds: ['fixture-terms'],
      }),
      availableRuntimes: runtimes,
    });
    expect(selected).toBeNull();
  });

  it('tests only the manually selected model without a silent fallback', () => {
    // On a 12 GB profile automatic selection would prefer QVikhr 1.7B; manually pinning the
    // smaller model must not silently add a fallback candidate.
    const plan = buildLocalModelLoadPlan({
      models: catalog.models,
      profile: profile(12),
      preference: preference({
        automatic: false,
        selectedModelId: 'vikhr-qwen2.5-0.5b-q4',
      }),
      availableRuntimes: runtimes,
    });
    expect(plan.map((candidate) => candidate.model.id)).toEqual(['vikhr-qwen2.5-0.5b-q4']);
  });

  it('honors a compact manual model override when the artifact is compatible', () => {
    const selected = selectLocalModel({
      models: catalog.models,
      profile: profile(12),
      preference: preference({
        automatic: false,
        selectedModelId: 'vikhr-qwen2.5-0.5b-q4',
      }),
      availableRuntimes: runtimes,
    });
    expect(selected?.model.id).toBe('vikhr-qwen2.5-0.5b-q4');
  });

  it('does not rank licence-gated or unavailable native-only candidates', () => {
    const ranked = rankLocalModels({
      models: [...catalog.models, gatedUnpublishedModel(), nativeOnlyUnavailableModel()],
      profile: profile(16),
      preference: preference(),
      availableRuntimes: runtimes,
    });
    expect(ranked.map((item) => item.model.id)).not.toContain('gated-unpublished-fixture');
    expect(ranked.map((item) => item.model.id)).not.toContain('native-only-fixture');
  });

  it('prefers the llama-native artifact over wllama-web on a native Android device', () => {
    const selected = selectLocalModel({
      models: catalog.models,
      profile: { ...profile(4), platform: 'android', nativeContainer: true },
      preference: preference(),
      availableRuntimes: new Set(['wllama-web', 'llama-native']),
    });
    expect(selected?.model.id).toBe('vikhr-qwen2.5-0.5b-q4');
    expect(selected?.artifact.runtime).toBe('llama-native');
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
