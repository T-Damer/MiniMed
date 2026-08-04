export interface ToolLinkDefinition<Kind extends string> {
  readonly id: string;
  readonly kind: Kind;
  readonly slug: string;
  readonly phrases: readonly string[];
}

export type ToolLinkSegment<Kind extends string> =
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: Kind;
      readonly id: string;
      readonly slug: string;
      readonly value: string;
    };

export interface ToolLinkMatcher<Kind extends string> {
  readonly ambiguousPhrases: readonly string[];
  segment(text: string): readonly ToolLinkSegment<Kind>[];
}

interface IndexedPhrase<Kind extends string> {
  readonly definition: ToolLinkDefinition<Kind>;
  readonly normalized: string;
  readonly pattern: string;
}

function normalizePhrase(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function phrasePattern(value: string): string {
  return value
    .trim()
    .split(/\s+/u)
    .map((part) => escapeRegExp(part).replace(/[её]/giu, '[её]'))
    .join('\\s+');
}

function targetKey(definition: ToolLinkDefinition<string>): string {
  return `${definition.kind}\u0000${definition.id}\u0000${definition.slug}`;
}

export function createToolLinkMatcher<Kind extends string>(
  definitions: readonly ToolLinkDefinition<Kind>[],
): ToolLinkMatcher<Kind> {
  const candidates = new Map<string, Map<string, ToolLinkDefinition<Kind>>>();

  for (const definition of definitions) {
    for (const phrase of definition.phrases) {
      const normalized = normalizePhrase(phrase);
      if (normalized.length < 3) continue;
      const targets = candidates.get(normalized) ?? new Map();
      targets.set(targetKey(definition), definition);
      candidates.set(normalized, targets);
    }
  }

  const ambiguousPhrases: string[] = [];
  const phrases: IndexedPhrase<Kind>[] = [];
  for (const [normalized, targets] of candidates) {
    if (targets.size !== 1) {
      ambiguousPhrases.push(normalized);
      continue;
    }
    const definition = targets.values().next().value;
    if (!definition) continue;
    phrases.push({
      definition,
      normalized,
      pattern: phrasePattern(normalized),
    });
  }

  phrases.sort(
    (left, right) =>
      right.normalized.length - left.normalized.length ||
      left.normalized.localeCompare(right.normalized, 'ru-RU'),
  );
  ambiguousPhrases.sort((left, right) => left.localeCompare(right, 'ru-RU'));

  const phraseByNormalized = new Map(phrases.map((phrase) => [phrase.normalized, phrase] as const));
  const expression = phrases.length
    ? new RegExp(
        `(^|[^\\p{L}\\p{M}\\p{N}_])(${phrases.map((phrase) => phrase.pattern).join('|')})(?=$|[^\\p{L}\\p{M}\\p{N}_])`,
        'giu',
      )
    : null;

  return {
    ambiguousPhrases,
    segment(text: string): readonly ToolLinkSegment<Kind>[] {
      if (!text || !expression) return [{ kind: 'text', value: text }];
      expression.lastIndex = 0;
      const segments: ToolLinkSegment<Kind>[] = [];
      let cursor = 0;

      for (let match = expression.exec(text); match; match = expression.exec(text)) {
        const prefix = match[1] ?? '';
        const linkedText = match[2];
        if (!linkedText) continue;
        const phrase = phraseByNormalized.get(normalizePhrase(linkedText));
        if (!phrase) continue;
        const start = match.index + prefix.length;
        const end = start + linkedText.length;
        if (start < cursor) continue;
        if (start > cursor) segments.push({ kind: 'text', value: text.slice(cursor, start) });
        segments.push({
          kind: phrase.definition.kind,
          id: phrase.definition.id,
          slug: phrase.definition.slug,
          value: text.slice(start, end),
        });
        cursor = end;
      }

      if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) });
      return segments.length > 0 ? segments : [{ kind: 'text', value: text }];
    },
  };
}
