import type {
  LocalModelArtifact,
  LocalModelDescriptor,
  LocalModelDeviceProfile,
  LocalModelPreference,
  LocalModelRuntimeKind,
  LocalModelSelection,
} from './types';

const STORAGE_MARGIN_BYTES = 256_000_000;
const METERED_LARGE_DOWNLOAD_BYTES = 750_000_000;

export interface LocalModelSelectionInput {
  readonly models: readonly LocalModelDescriptor[];
  readonly profile: LocalModelDeviceProfile;
  readonly preference: LocalModelPreference;
  readonly availableRuntimes: ReadonlySet<LocalModelRuntimeKind>;
  readonly failedModelIds?: ReadonlySet<string>;
}

function licenseAccepted(model: LocalModelDescriptor, preference: LocalModelPreference): boolean {
  return (
    !model.license.requiresAcceptance || preference.acceptedLicenseIds.includes(model.license.id)
  );
}

function artifactFor(
  model: LocalModelDescriptor,
  profile: LocalModelDeviceProfile,
  availableRuntimes: ReadonlySet<LocalModelRuntimeKind>,
): LocalModelArtifact | null {
  const candidates = model.artifacts
    .filter(
      (artifact) =>
        artifact.published &&
        artifact.platforms.includes(profile.platform) &&
        availableRuntimes.has(artifact.runtime),
    )
    .toSorted((left, right) => {
      const runtimePreference = (artifact: LocalModelArtifact): number => {
        if (profile.nativeContainer && artifact.runtime === 'litert-native') return 30;
        if (profile.nativeContainer && artifact.runtime === 'cactus-native') return 20;
        if (artifact.runtime === 'wllama-web') return 10;
        return 0;
      };
      return (
        runtimePreference(right) - runtimePreference(left) ||
        left.downloadBytes - right.downloadBytes
      );
    });
  return candidates[0] ?? null;
}

function memoryFits(model: LocalModelDescriptor, profile: LocalModelDeviceProfile): boolean {
  return profile.deviceMemoryGb === null || profile.deviceMemoryGb >= model.minimumMemoryGb;
}

function storageFits(artifact: LocalModelArtifact, profile: LocalModelDeviceProfile): boolean {
  return (
    profile.freeStorageBytes === null ||
    profile.freeStorageBytes >= artifact.downloadBytes + STORAGE_MARGIN_BYTES
  );
}

function memoryScore(memoryHeadroom: number): number {
  // Missing memory should disqualify or strongly penalize a model. Extra memory merely removes risk;
  // it must not make the weakest model beat a materially better model on a capable device.
  return memoryHeadroom >= 0
    ? Math.min(6, memoryHeadroom * 1.5)
    : Math.max(-12, memoryHeadroom * 3);
}

function candidateScore(
  model: LocalModelDescriptor,
  artifact: LocalModelArtifact,
  profile: LocalModelDeviceProfile,
  automatic: boolean,
): LocalModelSelection {
  let score = model.qualityScore * 0.42 + model.russianPriority * 0.48;
  const reasons: string[] = [];
  if (profile.deviceMemoryGb !== null) {
    const memoryHeadroom = profile.deviceMemoryGb - model.recommendedMemoryGb;
    score += memoryScore(memoryHeadroom);
    reasons.push(
      memoryHeadroom >= 0
        ? `достаточный запас памяти (${profile.deviceMemoryGb} ГБ)`
        : `память ниже рекомендованных ${model.recommendedMemoryGb} ГБ`,
    );
  } else {
    score -= model.minimumMemoryGb * 1.4;
    reasons.push('объём памяти браузером не сообщается');
  }
  score -= artifact.downloadBytes / 250_000_000;
  if (profile.saveData || profile.effectiveConnectionType?.includes('2g')) {
    score -= artifact.downloadBytes >= METERED_LARGE_DOWNLOAD_BYTES ? 18 : 4;
    reasons.push('учтён режим экономии трафика');
  }
  if (artifact.runtime === 'litert-native') {
    score += 9;
    reasons.push('нативный LiteRT runtime');
  } else if (artifact.runtime === 'cactus-native') {
    score += 5;
    reasons.push('нативный GGUF runtime');
  } else {
    reasons.push('CPU/WebAssembly runtime доступен на этой платформе');
  }
  if (!automatic) score += 2;
  return { model, artifact, score, reasons };
}

export function rankLocalModels(input: LocalModelSelectionInput): readonly LocalModelSelection[] {
  const ranked: LocalModelSelection[] = [];
  for (const model of input.models) {
    if (input.failedModelIds?.has(model.id)) continue;
    if (!licenseAccepted(model, input.preference)) continue;
    if (!memoryFits(model, input.profile)) continue;
    const artifact = artifactFor(model, input.profile, input.availableRuntimes);
    if (!artifact || !storageFits(artifact, input.profile)) continue;
    ranked.push(candidateScore(model, artifact, input.profile, input.preference.automatic));
  }
  return ranked.toSorted(
    (left, right) => right.score - left.score || left.model.id.localeCompare(right.model.id),
  );
}

export function selectLocalModel(input: LocalModelSelectionInput): LocalModelSelection | null {
  const ranked = rankLocalModels(input);
  const override = input.preference.selectedModelId;
  if (!input.preference.automatic && override) {
    return ranked.find((candidate) => candidate.model.id === override) ?? null;
  }
  return ranked[0] ?? null;
}

export function buildLocalModelLoadPlan(
  input: LocalModelSelectionInput,
): readonly LocalModelSelection[] {
  const primary = selectLocalModel(input);
  if (!primary) return [];
  if (!input.preference.automatic) return [primary];
  const fallback = rankLocalModels(input).find(
    (candidate) =>
      candidate.model.id !== primary.model.id &&
      candidate.artifact.downloadBytes < primary.artifact.downloadBytes &&
      candidate.model.minimumMemoryGb <= primary.model.minimumMemoryGb,
  );
  return fallback ? [primary, fallback] : [primary];
}
