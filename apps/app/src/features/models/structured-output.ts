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

/**
 * A JSON object the token limit cut off, closed right after its last complete value; the values the
 * model finished are kept, the unfinished one is dropped. Null when nothing complete precedes the cut.
 */
export function extractTruncatedJson(value: string): unknown | null {
  const cleaned = withoutThinking(value);
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  const closers: string[] = [];
  let candidate: string | null = null;
  let inString = false;
  let escaped = false;
  for (let index = start; index < cleaned.length; index += 1) {
    const character = cleaned[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') closers.push('}');
    else if (character === '[') closers.push(']');
    else if (character === '}' || character === ']') {
      if (closers.pop() !== character) return null;
      candidate = cleaned.slice(start, index + 1) + closers.toReversed().join('');
      if (closers.length === 0) break;
    }
  }
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    // The cut fell inside a key or after a dangling comma: nothing complete to keep at this point.
    return null;
  }
}

export interface LocalModelProbe {
  readonly intent: string;
  readonly ageYears: number;
  readonly concepts: readonly string[];
}

export function normalizeLocalModelProbe(value: unknown): LocalModelProbe | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as {
    readonly intent?: unknown;
    readonly ageYears?: unknown;
    readonly concepts?: unknown;
  };
  const intent = typeof record.intent === 'string' ? record.intent.trim() : '';
  const rawAge = record.ageYears;
  const ageYears =
    typeof rawAge === 'number'
      ? rawAge
      : typeof rawAge === 'string' && rawAge.trim() !== ''
        ? Number(rawAge)
        : Number.NaN;
  const concepts = Array.isArray(record.concepts)
    ? record.concepts
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  if (!intent || !Number.isFinite(ageYears) || concepts.length === 0) return null;
  return { intent, ageYears, concepts };
}
