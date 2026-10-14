/**
 * Which ATC codes of an ЕСКЛП МНН card the interaction index carries (ATC4).
 *
 * A card's codes decide two things in the index: the classes a drug belongs to when another
 * drug's instruction names a class («НПВП», «противовирусные», class rules by ATC prefix), and
 * which class mentions in a drug's own instruction are the drug describing itself. A wrong code
 * therefore creates or hides a warning, so the codes are chosen here, from the node fields the ATC
 * fill leaves (`tools/ingest/src/localmed_ingest/atc_fill.py`), not read from the card total:
 *
 * - a node's completed `atcCode` (the registry's own code, a filled `~`, a refined group stub);
 * - for a node flagged `conflict` or `unconfirmed` only the registry value, never a candidate: the
 *   sources disagree or rest on one OCR text, so no code of theirs may add a warning;
 * - the `atcConsensus` code of a stub conflict (ATC3: two independent kinds of source agree on one
 *   substance code). Class membership and own-class suppression use BOTH the registry stub and the
 *   consensus code: the stub stays the official value, the substance code is the more specific
 *   one, and a drug is a member of every class either names (the owner's «show both»);
 * - minus the declared exceptions (`data/atc-code-exceptions.json`): a code the review found
 *   wrong for the product, with the reason and the review entry that decided it.
 */

export interface AtcNodeFields {
  readonly atcCode?: unknown;
  readonly atcOriginal?: unknown;
  readonly atcFlag?: unknown;
  readonly atcConsensus?: unknown;
}

export interface AtcCodeException {
  readonly card: string;
  readonly code: string;
  readonly reason: string;
  /** The entry of the committed review (`docs/research/atc-index-review-*.json`) that decided it. */
  readonly review: string;
}

export interface AtcCodeSelection {
  /** The codes the index carries, sorted. */
  readonly codes: readonly string[];
  /** Codes of the card that were left out and why (a declared exception). */
  readonly excluded: readonly { readonly code: string; readonly reason: string }[];
  /** Per code: where it comes from, for the review (`registry`, `completed`, `consensus`). */
  readonly origins: Readonly<Record<string, readonly string[]>>;
}

/** An ATC code of any level: `A`, `A01`, `A01A`, `A01AD`, `A01AD11`. */
const ATC_CODE = /^[A-Z](?:\d{2}(?:[A-Z](?:[A-Z](?:\d{2})?)?)?)?$/u;
/** A substance code (level 5). */
const ATC_SUBSTANCE = /^[A-Z]\d{2}[A-Z]{2}\d{2}$/u;

const UNRELIABLE_FLAGS: ReadonlySet<unknown> = new Set(['conflict', 'unconfirmed']);

function codeOf(value: unknown): string | null {
  return typeof value === 'string' && ATC_CODE.test(value.trim()) ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A consensus the ingest accepted: a substance code, outside a stub conflict nowhere else. */
export function consensusCodeOf(node: AtcNodeFields): string | null {
  if (node.atcFlag !== 'conflict') return null;
  const consensus = node.atcConsensus;
  if (!isRecord(consensus)) return null;
  const code = consensus['code'];
  const sources = consensus['sources'];
  if (typeof code !== 'string' || !ATC_SUBSTANCE.test(code)) return null;
  if (!Array.isArray(sources) || sources.length < 2) return null;
  return code;
}

export function selectAtcCodes(
  cardId: string,
  nodes: readonly AtcNodeFields[],
  exceptions: readonly AtcCodeException[] = [],
): AtcCodeSelection {
  const origins = new Map<string, Set<string>>();
  const add = (code: string | null, origin: string): void => {
    if (!code) return;
    const list = origins.get(code);
    if (list) list.add(origin);
    else origins.set(code, new Set([origin]));
  };
  for (const node of nodes) {
    if (UNRELIABLE_FLAGS.has(node.atcFlag)) {
      // Never a candidate: the registry value, which the sources did not replace.
      add(codeOf(node.atcOriginal ?? node.atcCode), 'registry');
      add(consensusCodeOf(node), 'consensus');
      continue;
    }
    add(codeOf(node.atcCode), typeof node.atcOriginal === 'string' ? 'completed' : 'registry');
  }
  const excluded: { code: string; reason: string }[] = [];
  for (const exception of exceptions) {
    if (exception.card === cardId && origins.delete(exception.code)) {
      excluded.push({ code: exception.code, reason: exception.reason });
    }
  }
  const codes = [...origins.keys()].toSorted();
  return {
    codes,
    excluded,
    origins: Object.fromEntries(codes.map((code) => [code, [...(origins.get(code) ?? [])]])),
  };
}

/**
 * `atcOriginal` is only written where the fill changed the code, so a node without one holds the
 * registry's own value. `completed` marks the codes that came from the fill.
 */
export function selectAtcCodesOfMetadata(
  cardId: string,
  metadata: Record<string, unknown>,
  exceptions: readonly AtcCodeException[] = [],
): AtcCodeSelection {
  const nodes = Array.isArray(metadata['smnnNodes'])
    ? (metadata['smnnNodes'] as readonly AtcNodeFields[])
    : [];
  return selectAtcCodes(cardId, nodes, exceptions);
}

/** The shape of `data/atc-code-exceptions.json`, validated where it is read. */
export function parseAtcCodeExceptions(value: unknown): readonly AtcCodeException[] {
  if (!isRecord(value) || !Array.isArray(value['exceptions'])) {
    throw new Error('atc-code-exceptions: «exceptions» is missing');
  }
  return (value['exceptions'] as readonly unknown[]).map((item, position) => {
    if (!isRecord(item)) throw new Error(`atc-code-exceptions[${position}] is not an object`);
    const { card, code, reason, review } = item;
    if (typeof card !== 'string' || !card.startsWith('esklp.mnn.')) {
      throw new Error(`atc-code-exceptions[${position}]: card must be an esklp.mnn.* id`);
    }
    if (typeof code !== 'string' || !ATC_CODE.test(code)) {
      throw new Error(`atc-code-exceptions[${position}]: «${String(code)}» is not an ATC code`);
    }
    if (typeof reason !== 'string' || reason.trim().length < 10) {
      throw new Error(`atc-code-exceptions[${position}]: a reason is required`);
    }
    if (typeof review !== 'string' || review.trim() === '') {
      throw new Error(`atc-code-exceptions[${position}]: the review entry is required`);
    }
    return { card, code, reason, review };
  });
}
