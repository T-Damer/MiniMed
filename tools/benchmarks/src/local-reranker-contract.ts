/** Research-only boundary. Never let a classifier invent or remove a source result. */
export interface LocalCandidate {
  readonly id: string;
  readonly text: string;
  readonly strictIdentity: boolean;
}

export interface LocalRankingResponse {
  readonly status: string;
  readonly orderedIds: readonly string[];
  readonly experimentalIds: readonly string[];
  readonly applied: boolean;
  readonly inferenceMs: number;
}

export function validateLocalRankingResponse(
  value: unknown,
  candidates: readonly LocalCandidate[],
  allowApply: boolean,
): LocalRankingResponse {
  if (!value || typeof value !== 'object') throw new Error('Invalid local model response.');
  const row = value as Record<string, unknown>;
  const original = candidates.map((candidate) => candidate.id);
  const allowed = new Set(original);
  if (allowed.size !== original.length) throw new Error('Duplicate source identities.');
  const permutation = (input: unknown): readonly string[] => {
    if (
      !Array.isArray(input) ||
      input.length !== original.length ||
      input.some((id) => typeof id !== 'string' || !allowed.has(id)) ||
      new Set(input).size !== original.length
    ) {
      throw new Error('Model response is not a source-preserving permutation.');
    }
    return input as string[];
  };
  if (
    row.schemaVersion !== 1 ||
    typeof row.status !== 'string' ||
    !['observe', 'experimental', 'fallback', 'identity-bypass', 'insufficient-candidates'].includes(
      row.status,
    ) ||
    typeof row.applied !== 'boolean' ||
    typeof row.inferenceMs !== 'number' ||
    !Number.isFinite(row.inferenceMs) ||
    row.inferenceMs < 0
  ) {
    throw new Error('Invalid local model response metadata.');
  }
  const orderedIds = permutation(row.orderedIds);
  const experimentalIds = permutation(row.experimentalIds);
  const unchanged = (ids: readonly string[]) => ids.every((id, index) => id === original[index]);
  const guarded = candidates.some((candidate) => candidate.strictIdentity);
  if (
    (row.applied && (!allowApply || guarded || row.status !== 'experimental')) ||
    (row.applied && orderedIds.some((id, index) => id !== experimentalIds[index])) ||
    (!row.applied && (row.status === 'experimental' || !unchanged(orderedIds))) ||
    (guarded && (!unchanged(orderedIds) || !unchanged(experimentalIds))) ||
    (row.status === 'fallback' && !unchanged(experimentalIds))
  ) {
    throw new Error('Local model bypassed deterministic availability or identity protection.');
  }
  return {
    status: row.status,
    orderedIds,
    experimentalIds,
    applied: row.applied,
    inferenceMs: row.inferenceMs,
  };
}
