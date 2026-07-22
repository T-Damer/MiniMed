import type {
  LocalModelArtifact,
  LocalModelDescriptor,
  LocalModelDeviceProfile,
  LocalModelPreference,
  LocalModelRuntimeKind,
  LocalModelSelection,
} from './types';

const STORAGE_HEADROOM_BYTES = 256 * 1024 * 1024;
const AUTOMATIC_LARGE_DOWNLOAD_BYTES = 1_250_000_000;
const BROWSER_MAX_SINGLE_ARTIFACT_BYTES = 2_000_000_000;

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

function artifactFits(
  artifact: LocalModelArtifact,
  profile: LocalModelDeviceProfile,
  availableRuntimes: ReadonlySet<LocalModelRuntimeKind>,
): boolean {
  if (!artifact.published) return false;
  if (!artifact.platforms.includes(profile.platform)) return false;
  if (!availableRuntimes.has(artifact.runtime)) return false;
  if (
    artifact.runtime === 'wllama-web' &&
    artifact.downloadBytes >= BROWSER_MAX_SINGLE_ARTIFACT_BYTES
  ) {
    return false;
  }
  if (
    profile.freeStorageBytes !== null &&
    profile.freeStorageBytes < artifact.downloadBytes * 1.35 + STORAGE_HEADROOM_BYTES
  ) {
    return false;
  }
  return true;
}

function candidateScore(
  model: LocalModelDescriptor,
  artifact: LocalModelArtifact,
  profile: LocalModelDeviceProfile,
  automatic: boolean,
): LocalModelSelection {
  const reasons: string[] = [];
  let score = model.qualityScore * 1.6 + model.russianPriority * 1.2;
  const memory = profile.deviceMemoryGb;
  if (memory !== null) {
    if (memory >= model.recommendedMemoryGb) {
      score += 30;
      reasons.push('достаточный запас памяти');
    } else if (memory >= model.minimumMemoryGb) {
      score += 8;
      reasons.push('минимальный запас памяти');
    }
  } else {
    score -= Math.max(0, model.minimumMemoryGb - 4) * 9;
    reasons.push('объём памяти браузер не сообщил');
  }
  if (artifact.runtime === 'wllama-web' && profile.webgpu) {
    score += 12;
    reasons.push('доступен WebGPU');
  }
  if (artifact.runtime !== 'wllama-web') {
    score += 18;
    reasons.push('доступен нативный runtime');
  }
  const sizeGb = artifact.downloadBytes / 1_000_000_000;
  score -= sizeGb * 18;
  if (automatic && artifact.downloadBytes > AUTOMATIC_LARGE_DOWNLOAD_BYTES) {
    const strongDevice = (memory ?? 0) >= Math.max(12, model.recommendedMemoryGb);
    if (!strongDevice) {
      score -= 85;
      reasons.push('большая автоматическая загрузка');
    }
  }
  if (profile.saveData) {
    score -= artifact.downloadBytes / 5_000_000;
    reasons.push('включена экономия трафика');
  }
  if (profile.effectiveConnectionType?.includes('2g')) {
    score -= 120;
    reasons.push('медленное соединение');
  }
  if (profile.cpuProbeScore < 1500 && artifact.runtime === 'wllama-web') {
    score -= model.parameterCount / 40_000_000;
    reasons.push('слабый CPU-профиль');
  }
  return { model, artifact, score, reasons };
}

export function rankLocalModels(input: LocalModelSelectionInput): readonly LocalModelSelection[] {
  const failed = input.failedModelIds ?? new Set<string>();
  const ranked: LocalModelSelection[] = [];
  for (const model of input.models) {
    if (failed.has(model.id)) continue;
    if (!licenseAccepted(model, input.preference)) continue;
    if (
      input.profile.deviceMemoryGb !== null &&
      input.profile.deviceMemoryGb < model.minimumMemoryGb
    ) {
      continue;
    }
    const artifacts = model.artifacts
      .filter((artifact) => artifactFits(artifact, input.profile, input.availableRuntimes))
      .toSorted((left, right) => {
        const leftNative = left.runtime === 'wllama-web' ? 0 : 1;
        const rightNative = right.runtime === 'wllama-web' ? 0 : 1;
        return rightNative - leftNative || left.downloadBytes - right.downloadBytes;
      });
    const artifact = artifacts[0];
    if (!artifact) continue;
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
    return ranked.find((candidate) => candidate.model.id === override) ?? ranked[0] ?? null;
  }
  return ranked[0] ?? null;
}

export function buildLocalModelLoadPlan(
  input: LocalModelSelectionInput,
): readonly LocalModelSelection[] {
  const primary = selectLocalModel(input);
  if (!primary) return [];
  const fallback = rankLocalModels(input).find(
    (candidate) =>
      candidate.model.id !== primary.model.id &&
      candidate.artifact.downloadBytes < primary.artifact.downloadBytes &&
      candidate.model.minimumMemoryGb <= primary.model.minimumMemoryGb,
  );
  return fallback ? [primary, fallback] : [primary];
}
