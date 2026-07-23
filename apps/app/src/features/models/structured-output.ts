export function withoutThinking(value: string): string {
  return value.replace(/<think>[\s\S]*?<\/think>/giu, '').trim();
}

function fencedCandidates(value: string): string[] {
  const candidates: string[] = [];
  const pattern = /```(?:json)?\s*([\s\S]*?)```/giu;
  for (const match of value.matchAll(pattern)) {
    const candidate = match[1]?.trim();
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function balancedObjectCandidates(value: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character !== '}' || depth === 0) continue;
    depth -= 1;
    if (depth === 0 && start >= 0) {
      candidates.push(value.slice(start, index + 1));
      start = -1;
    }
  }
  return candidates;
}

export function extractStructuredJson(value: string): unknown | null {
  const cleaned = withoutThinking(value);
  const candidates = [cleaned, ...fencedCandidates(cleaned), ...balancedObjectCandidates(cleaned)];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    try {
      return JSON.parse(normalized) as unknown;
    } catch {
      // Small local models often wrap a valid object in a sentence or Markdown fence.
    }
  }
  return null;
}

export interface LocalModelProbe {
  readonly intent: string;
  readonly ageYears: number;
  readonly concepts: readonly string[];
}

export function normalizeLocalModelProbe(value: unknown): LocalModelProbe | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Readonly<Record<string, unknown>>;
  const intent = typeof record['intent'] === 'string' ? record['intent'].trim() : '';
  const rawAge = record['ageYears'];
  const ageYears =
    typeof rawAge === 'number'
      ? rawAge
      : typeof rawAge === 'string' && rawAge.trim() !== ''
        ? Number(rawAge)
        : Number.NaN;
  const concepts = Array.isArray(record['concepts'])
    ? record['concepts']
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  if (!intent || !Number.isFinite(ageYears) || concepts.length === 0) return null;
  return { intent, ageYears, concepts };
}
