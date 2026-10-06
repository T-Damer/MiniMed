/**
 * Which instruction sections are searched for named drugs, and what is recorded for a hit (INT1).
 * Pure: the build script feeds it documents read from the released modules; the unit tests feed it
 * small texts.
 */
import {
  canonicalSectionText,
  sectionChecksum,
  spanDisplayText,
  splitSentenceSpans,
} from './interaction-text';
import {
  type Mention,
  type MentionFinder,
  type TextToken,
  tokenizeForMatching,
} from './mention-matcher';
import { ANALYTE_SUBSTANCE_KEYS, stemsOfKey } from './substance-names';

/** Why a sentence was kept: the section of the instruction it stands in. */
export const SPAN_FLAG_INTERACTIONS = 1;
export const SPAN_FLAG_SPECIAL = 2;
export const SPAN_FLAG_CONTRAINDICATIONS = 4;
export const SPAN_FLAG_CAUTION = 8;
/** A patient leaflet has no typed interaction section: its general sections are searched instead. */
export const SPAN_FLAG_LEAFLET_BODY = 16;

/**
 * Word starts that put two drugs together in one sentence. A patient leaflet has no typed
 * interaction section, so its general sections are searched only for sentences that also say
 * something about taking drugs together.
 */
const COADMINISTRATION_CUES = [
  'одновремен',
  'совместн',
  'вместе',
  'сочетан',
  'комбинир',
  'взаимодейств',
  'принима',
  'принимал',
  'употребл',
];

/**
 * «Аллергия на пенициллин», «гиперчувствительность к X»: the drug is named as an allergen, not as
 * something taken together. A hit with one of these words just before it is dropped outside the
 * interaction section.
 */
const ALLERGY_CUES = ['аллерг', 'гиперчувствительн', 'непереносим', 'сенсибилизац'];
const ALLERGY_WINDOW = 5;

function followsAllergyWord(tokens: readonly TextToken[], mention: Mention): boolean {
  const first = tokens.findIndex((token) => token.start >= mention.start);
  if (first < 0) return false;
  return tokens
    .slice(Math.max(0, first - ALLERGY_WINDOW), first)
    .some((token) => ALLERGY_CUES.some((cue) => token.stem.startsWith(cue)));
}

function hasCoadministrationCue(tokens: readonly { readonly stem: string }[]): boolean {
  return tokens.some((token) => COADMINISTRATION_CUES.some((cue) => token.stem.startsWith(cue)));
}

const FLAG_BY_SECTION_TYPE: Readonly<Record<string, number>> = {
  interactions: SPAN_FLAG_INTERACTIONS,
  'special-instructions': SPAN_FLAG_SPECIAL,
  contraindications: SPAN_FLAG_CONTRAINDICATIONS,
  caution: SPAN_FLAG_CAUTION,
};

export interface ExtractSection {
  readonly id: string;
  readonly type: string | null;
  readonly title: string;
  /** The section's chunks in reading order (`original_text`). */
  readonly chunks: readonly string[];
}

export interface ExtractedSpan {
  /** Index into `ExtractedDocument.sections`. */
  readonly section: number;
  readonly start: number;
  readonly end: number;
  readonly flags: number;
  /** Targets found in the sentence: `s:<substance key>` or `c:<ATC code>`. */
  readonly targets: readonly string[];
}

export interface ExtractedDocument {
  readonly sections: readonly { readonly id: string; readonly checksum: string }[];
  readonly spans: readonly ExtractedSpan[];
  readonly hasInteractionSection: boolean;
}

/** Section types never searched: they name drugs as a form, a component, a comparator or a dose. */
function sectionFlag(section: ExtractSection, leafletBody: boolean): number {
  const typed = section.type ? (FLAG_BY_SECTION_TYPE[section.type] ?? 0) : 0;
  if (typed) return typed;
  return leafletBody && section.type === 'other' ? SPAN_FLAG_LEAFLET_BODY : 0;
}

/** The stems of the words a mention covers. */
function mentionStems(tokens: readonly TextToken[], mention: Mention): string {
  return tokens
    .filter((token) => token.start >= mention.start && token.end <= mention.end)
    .map((token) => token.stem)
    .join(' ');
}

/**
 * Whether a hit is a real mention of ANOTHER drug or class in this kind of section: not the
 * instruction's own substance (or a word of its name: «препараты кальция» in the instruction of
 * кальция глюконат), not a class that is just the own substance's name, not an own class outside
 * the interaction section, and an element searched only where the instruction means a drug.
 */
function keepMention(
  mention: Mention,
  tokens: readonly TextToken[],
  flags: number,
  ownKeys: ReadonlySet<string>,
  ownStems: ReadonlySet<string>,
  ownAtc: readonly string[],
  coadministration: boolean,
): boolean {
  if (flags !== SPAN_FLAG_INTERACTIONS && followsAllergyWord(tokens, mention)) return false;
  if (mention.target.startsWith('s:')) {
    const key = mention.target.slice(2);
    if (ownKeys.has(key)) return false;
    const stems = stemsOfKey(key);
    if (stems.every((stem) => ownStems.has(stem))) return false;
    return flags === SPAN_FLAG_INTERACTIONS || !ANALYTE_SUBSTANCE_KEYS.has(key);
  }
  // A class named after a single substance («Окситоцин», «Гепарин») is the substance's own name.
  if (ownKeys.has(mentionStems(tokens, mention))) return false;
  // «Как и другие НПВП», «у пациентов, принимавших антидепрессанты» in a warning describes the
  // drug's own class. Only an interaction section means «together with» that class; in a warning a
  // class counts when the sentence also says something about taking drugs together.
  if (flags !== SPAN_FLAG_INTERACTIONS) {
    const code = mention.target.slice(2);
    return coadministration && !ownAtc.some((atc) => atc.startsWith(code));
  }
  return true;
}

export function extractDocumentSpans(
  sections: readonly ExtractSection[],
  matcher: MentionFinder,
  options: {
    readonly isLeaflet: boolean;
    /** Substance keys of the document's own card(s): its own name is no interaction. */
    readonly ownKeys: ReadonlySet<string>;
    /** ATC codes of the document's own card(s). */
    readonly ownAtcCodes?: readonly string[];
    /** Called for every kept sentence with its text; for audits, never part of the asset. */
    readonly onSentence?: (sentence: {
      readonly section: ExtractSection;
      readonly flags: number;
      readonly text: string;
      readonly targets: readonly string[];
      /** The words of the sentence that were taken for names. */
      readonly surfaces: readonly string[];
    }) => void;
  },
): ExtractedDocument {
  const ownStems = new Set([...options.ownKeys].flatMap((key) => stemsOfKey(key)));
  const hasInteractionSection = sections.some(
    (section) => section.type === 'interactions' && section.chunks.length > 0,
  );
  // A leaflet that has a typed interaction section is read like any other instruction.
  const leafletBody = options.isLeaflet && !hasInteractionSection;
  const kept: { id: string; checksum: string }[] = [];
  const spans: ExtractedSpan[] = [];
  for (const section of sections) {
    const flags = sectionFlag(section, leafletBody);
    if (flags === 0 || section.chunks.length === 0) continue;
    const canonical = canonicalSectionText(section.chunks);
    const sectionSpans: ExtractedSpan[] = [];
    for (const span of splitSentenceSpans(canonical.text)) {
      const rawText = canonical.text.slice(span.start, span.end);
      const tokens = tokenizeForMatching(rawText);
      const cue = hasCoadministrationCue(tokens);
      if (flags === SPAN_FLAG_LEAFLET_BODY && !cue) continue;
      const ownAtc = options.ownAtcCodes ?? [];
      const mentions = matcher
        .find(tokens)
        .filter((mention) =>
          keepMention(mention, tokens, flags, options.ownKeys, ownStems, ownAtc, cue),
        );
      const targets = [...new Set(mentions.map((mention) => mention.target))];
      if (targets.length === 0) continue;
      sectionSpans.push({ section: kept.length, start: span.start, end: span.end, flags, targets });
      options.onSentence?.({
        section,
        flags,
        text: spanDisplayText(canonical.text, span),
        targets,
        surfaces: mentions.map((mention) =>
          rawText.slice(mention.start, mention.end).replace(/\s+/gu, ' '),
        ),
      });
    }
    if (sectionSpans.length === 0) continue;
    kept.push({ id: section.id, checksum: sectionChecksum(canonical.text) });
    spans.push(...sectionSpans);
  }
  return { sections: kept, spans, hasInteractionSection };
}
