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
 *   wrong for the product, with the reason and the review entry that decided it;
 * - plus the declared class additions (`addClasses` in the same file, ATC4c, CLS1): a class the
 *   card belongs to for the interaction rules although its registry code puts it elsewhere. Two
 *   roles (owner 2026-10-14: «one drug can have many classes»): `primary` replaces a wrong code
 *   (the class joins the card's codes); `secondary` is an additional class that one COMPONENT
 *   brings (phenobarbital drops for the heart are also a hypnotic; a cold remedy with
 *   dextromethorphan is also a cough suppressant) and stays apart from the codes, with the
 *   component that brings it and a short label, so the interaction view can say «через
 *   фенобарбитал (снотворное)». Both match class sentences. Each addition quotes the product's
 *   own instruction as evidence; the build checks the quote against the instruction text.
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

/** An additional class of a card that one component brings (CLS1). */
export interface SecondaryClass {
  /** ATC group code (level 2–4), a prefix like a card's own codes. */
  readonly code: string;
  /** The component that brings the class, as the instruction names it («фенобарбитал»). */
  readonly via: string;
  /** What the class is called in the view, singular («снотворное»). */
  readonly label: string;
}

export type AtcClassRole = 'primary' | 'secondary';

/** A class a card is declared to belong to, on the evidence of the product's own instruction. */
export interface AtcClassAddition {
  readonly card: string;
  /** `primary`: replaces a wrong code; `secondary`: an additional class of one component. */
  readonly role: AtcClassRole;
  /** ATC group codes (level 2–4) the card is added to; they are prefixes, like a card's own codes. */
  readonly classes: readonly string[];
  /** Secondary only: the component that brings the classes. */
  readonly via?: string;
  /** Secondary only: the classes' name in the view, singular. */
  readonly label?: string;
  readonly reason: string;
  readonly evidence: {
    /** The instruction document that says it. */
    readonly document: string;
    readonly section: string;
    /** Verbatim text of that instruction; the build refuses an addition whose quote is not in it. */
    readonly quote: string;
  };
  /** The entry of the committed review (`docs/research/atc-index-review-*.json`) that decided it. */
  readonly review: string;
}

export interface AtcCodeSelection {
  /** The codes the index carries, sorted. */
  readonly codes: readonly string[];
  /** Primary classes added by a declaration (`addClasses`), included in `codes`. */
  readonly added: readonly string[];
  /** Secondary classes (CLS1): not in `codes`, sorted by code. */
  readonly secondary: readonly SecondaryClass[];
  /** Codes of the card that were left out and why (a declared exception). */
  readonly excluded: readonly { readonly code: string; readonly reason: string }[];
  /** Per code: where it comes from, for the review (`registry`, `completed`, `consensus`, `declared`). */
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
  additions: readonly AtcClassAddition[] = [],
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
  // Additions come last, so an exception for the same card and code never removes a declared class.
  const added: string[] = [];
  const secondary = new Map<string, SecondaryClass>();
  for (const addition of additions) {
    if (addition.card !== cardId) continue;
    for (const code of addition.classes) {
      if (addition.role === 'secondary') {
        secondary.set(code, { code, via: addition.via ?? '', label: addition.label ?? '' });
        continue;
      }
      if (!origins.has(code)) added.push(code);
      add(code, 'declared');
    }
  }
  const codes = [...origins.keys()].toSorted();
  return {
    codes,
    added: added.toSorted(),
    secondary: [...secondary.values()].toSorted((a, b) => a.code.localeCompare(b.code)),
    excluded,
    origins: Object.fromEntries(codes.map((code) => [code, [...(origins.get(code) ?? [])]])),
  };
}

/**
 * Secondary classes the primary codes already cover (a code that starts with the class code, or a
 * class code that starts with a code): a declaration that has become redundant, which the build
 * refuses so the data stays honest.
 */
export function redundantSecondary(selection: AtcCodeSelection): readonly SecondaryClass[] {
  return selection.secondary.filter((entry) =>
    selection.codes.some((code) => code.startsWith(entry.code) || entry.code.startsWith(code)),
  );
}

/**
 * `atcOriginal` is only written where the fill changed the code, so a node without one holds the
 * registry's own value. `completed` marks the codes that came from the fill.
 */
export function selectAtcCodesOfMetadata(
  cardId: string,
  metadata: Record<string, unknown>,
  exceptions: readonly AtcCodeException[] = [],
  additions: readonly AtcClassAddition[] = [],
): AtcCodeSelection {
  const nodes = Array.isArray(metadata['smnnNodes'])
    ? (metadata['smnnNodes'] as readonly AtcNodeFields[])
    : [];
  return selectAtcCodes(cardId, nodes, exceptions, additions);
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

/** A group code an addition may name: level 2–4 (`R05`, `R05D`), never a substance code. */
const ATC_GROUP = /^[A-Z]\d{2}(?:[A-Z][A-Z]?)?$/u;
const MIN_QUOTE_LENGTH = 20;

/** The `addClasses` list of `data/atc-code-exceptions.json`, validated where it is read. */
export function parseAtcClassAdditions(value: unknown): readonly AtcClassAddition[] {
  if (!isRecord(value)) throw new Error('atc-code-exceptions: not an object');
  const list = value['addClasses'];
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error('atc-code-exceptions: «addClasses» is not a list');
  const seen = new Set<string>();
  return (list as readonly unknown[]).map((item, position) => {
    const where = `atc-code-exceptions.addClasses[${position}]`;
    if (!isRecord(item)) throw new Error(`${where} is not an object`);
    const { card, classes, reason, evidence, review, via, label } = item;
    const role = item['role'] ?? 'primary';
    if (typeof card !== 'string' || !card.startsWith('esklp.mnn.')) {
      throw new Error(`${where}: card must be an esklp.mnn.* id`);
    }
    if (role !== 'primary' && role !== 'secondary') {
      throw new Error(`${where}: role must be «primary» or «secondary»`);
    }
    if (
      !Array.isArray(classes) ||
      classes.length === 0 ||
      classes.some((code) => typeof code !== 'string' || !ATC_GROUP.test(code))
    ) {
      throw new Error(`${where}: classes must be ATC group codes of level 2–4`);
    }
    for (const code of classes as readonly string[]) {
      if (seen.has(`${card}|${code}`)) {
        throw new Error(`${where}: ${code} is declared twice for ${card}`);
      }
      seen.add(`${card}|${code}`);
    }
    if (role === 'secondary') {
      if (typeof via !== 'string' || via.trim() === '') {
        throw new Error(`${where}: a secondary class names the component that brings it («via»)`);
      }
      if (typeof label !== 'string' || label.trim() === '') {
        throw new Error(`${where}: a secondary class has a label for the view («label»)`);
      }
    } else if (via !== undefined || label !== undefined) {
      throw new Error(`${where}: «via» and «label» belong to secondary classes`);
    }
    if (typeof reason !== 'string' || reason.trim().length < 10) {
      throw new Error(`${where}: a reason is required`);
    }
    if (!isRecord(evidence)) throw new Error(`${where}: the evidence is required`);
    const { document, section, quote } = evidence;
    if (typeof document !== 'string' || !document.endsWith('.instruction')) {
      throw new Error(`${where}: the evidence names an instruction document`);
    }
    if (typeof section !== 'string' || section.trim() === '') {
      throw new Error(`${where}: the evidence names the section`);
    }
    if (typeof quote !== 'string' || quote.trim().length < MIN_QUOTE_LENGTH) {
      throw new Error(`${where}: the evidence quotes the instruction`);
    }
    if (typeof review !== 'string' || review.trim() === '') {
      throw new Error(`${where}: the review entry is required`);
    }
    return {
      card,
      role,
      classes: [...classes] as string[],
      ...(role === 'secondary'
        ? { via: (via as string).trim(), label: (label as string).trim() }
        : {}),
      reason,
      evidence: { document, section, quote },
      review,
    };
  });
}

/** Text compared without regard to spacing, as the instruction chunks are reflowed. */
export function normalizeQuote(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().toLowerCase();
}

/**
 * Whether the evidence of an addition is in the instruction: a section whose title contains the
 * named one holds the quote (compared by `normalizeQuote`).
 */
export function additionEvidenceHolds(
  addition: AtcClassAddition,
  sections: readonly { readonly title: string; readonly text: string }[],
): boolean {
  const title = normalizeQuote(addition.evidence.section);
  const quote = normalizeQuote(addition.evidence.quote);
  return sections.some(
    (section) =>
      normalizeQuote(section.title).includes(title) && normalizeQuote(section.text).includes(quote),
  );
}
