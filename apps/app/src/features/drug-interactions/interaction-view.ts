/**
 * What the interaction tool shows for every pair of drugs (INT1): the states, the quoted
 * sentences and where they come from. Pure: the workspace passes in the index, the installed
 * instructions it has read and the class phrases; the same view feeds the screen, the print and the
 * share text, so they can never disagree.
 */
import type { MedicalDocument } from '@localmed/contracts';
import { displayDrugName } from '@/features/medications/drug-screen';
import {
  type InstructionSourceInfo,
  instructionSourceInfo,
} from '@/features/medications/instruction-source';
import type { ClassPhrase } from './class-phrases';
import type { DrugItem, PairCheck, SideCheck } from './interaction-check';
import { itemTargets } from './interaction-check';
import { SPAN_FLAG_INTERACTIONS, SPAN_FLAG_LEAFLET_BODY } from './interaction-extract';
import type { InteractionIndex } from './interaction-index';
import type { PrintPair, PrintSide } from './interaction-print';
import { type Quote, resolveQuotes, sentenceSectionLabel } from './interaction-quotes';
import { type PairSeverity, pairSeverity, type SeverityLookup } from './interaction-severity';
import { highlightPatterns, highlightSegments } from './mention-highlight';

export type DocumentState = 'loading' | 'missing' | { readonly document: MedicalDocument };

/**
 * `ready`: the instruction is installed and read. `not-installed`: the index knows the instruction
 * but its module is not installed. `no-instruction`: no instruction of this drug is in the index.
 * `substance`: alcohol has no instruction to read.
 */
export type SideState = 'ready' | 'loading' | 'not-installed' | 'no-instruction' | 'substance';

export interface SideView {
  readonly from: DrugItem;
  readonly to: DrugItem;
  readonly state: SideState;
  readonly documentId: string | null;
  /** The instruction module that holds the document, to offer its download. */
  readonly moduleId: string | null;
  /** Sentences the index lists for this side. */
  readonly count: number;
  readonly quotes: readonly Quote[];
  /** Sentences the installed text no longer matches (another edition). */
  readonly changed: number;
  /** Trade name of the instruction read, from the index. */
  readonly tradeName: string | null;
  readonly source: InstructionSourceInfo | null;
  readonly title: string | null;
}

export type PairStatus = 'found' | 'none' | 'incomplete';

export interface PairView {
  readonly a: DrugItem;
  readonly b: DrugItem;
  readonly status: PairStatus;
  readonly found: number;
  readonly sides: readonly SideView[];
  /** The DDInter label, only while the optional module is installed and a sentence is quotable. */
  readonly severity: PairSeverity | null;
}

function sideView(
  index: InteractionIndex,
  check: SideCheck,
  documents: ReadonlyMap<string, DocumentState>,
  phrases: readonly ClassPhrase[],
): SideView {
  const { from, to, documentId } = check;
  const base = {
    from,
    to,
    documentId,
    moduleId: null,
    count: check.sentences.length,
    quotes: [] as readonly Quote[],
    changed: 0,
    tradeName: null,
    source: null,
    title: null,
  } satisfies Omit<SideView, 'state'>;
  if (from.kind === 'alcohol') return { ...base, state: 'substance' };
  const document = documentId ? index.asset.documents[documentId] : undefined;
  if (!documentId || !document) return { ...base, state: 'no-instruction' };
  const known = {
    ...base,
    moduleId: index.asset.modules[document.m] ?? null,
    tradeName: document.t,
  };
  const loaded = documents.get(documentId);
  if (loaded === undefined || loaded === 'loading') return { ...known, state: 'loading' };
  if (loaded === 'missing') return { ...known, state: 'not-installed' };
  const patterns = highlightPatterns(index, itemTargets(index, to), phrases);
  const resolved = resolveQuotes(loaded.document, check.sentences, (text) =>
    highlightSegments(text, patterns),
  );
  return {
    ...known,
    state: 'ready',
    quotes: resolved.quotes,
    changed: resolved.changed,
    source: instructionSourceInfo(loaded.document),
    title: loaded.document.title,
  };
}

export function pairView(
  index: InteractionIndex,
  pair: PairCheck,
  documents: ReadonlyMap<string, DocumentState>,
  phrases: readonly ClassPhrase[],
  severity: SeverityLookup | null = null,
): PairView {
  const sides = [pair.aReadsB, pair.bReadsA]
    .map((check) => sideView(index, check, documents, phrases))
    .filter((side) => side.state !== 'substance');
  const found = pair.found;
  const missing = sides.some((side) => side.state === 'no-instruction');
  return {
    a: pair.a,
    b: pair.b,
    status: found > 0 ? 'found' : missing ? 'incomplete' : 'none',
    found,
    sides,
    severity: pairSeverity(severity, {
      firstId: pair.a.id,
      secondId: pair.b.id,
      quotable: pair.a.kind === 'drug' && pair.b.kind === 'drug' ? quotableCount(sides) : 0,
    }),
  };
}

function quotableCount(sides: readonly SideView[]): number {
  return sides.reduce((total, side) => total + side.quotes.length, 0);
}

/**
 * The sentences a side shows at once and those folded behind «ещё из других разделов»: the
 * interaction section (and a leaflet's general text, which has no typed interaction section) stay
 * in view, «Особые указания», «Противопоказания» and «С осторожностью» are folded (INT2).
 */
export function splitQuotes(quotes: readonly Quote[]): {
  readonly main: readonly Quote[];
  readonly other: readonly Quote[];
} {
  const inMain = (quote: Quote): boolean =>
    (quote.flags & (SPAN_FLAG_INTERACTIONS | SPAN_FLAG_LEAFLET_BODY)) !== 0;
  return {
    main: quotes.filter(inMain),
    other: quotes.filter((quote) => !inMain(quote)),
  };
}

/** A side whose instruction can be quoted now (or soon): the others have nothing to show. */
export function hasReadableSide(side: SideView): boolean {
  return side.state === 'ready' || side.state === 'loading';
}

/**
 * The instruction modules a pair needs to quote its sentences: only sides the index has sentences
 * for, one download for a module two drugs share.
 */
export function pairOfferModules(view: PairView): readonly string[] {
  return [
    ...new Set(
      view.sides.flatMap((side) =>
        side.state === 'not-installed' && side.count > 0 && side.moduleId ? [side.moduleId] : [],
      ),
    ),
  ];
}

export function otherSectionsLabel(count: number): string {
  return `ещё из других разделов (${count})`;
}

export function pairTitle(pair: Pick<PairView, 'a' | 'b'>): string {
  return `${pair.a.label} + ${pair.b.label}`;
}

/** The status line of a pair, as the screen and the print word it. */
export function pairStatusText(view: PairView): string {
  const names = view.sides
    .filter((side) => side.state === 'no-instruction')
    .map((side) => side.from.label);
  const noInstruction =
    names.length > 0 ? `; для ${names.join(', ')} инструкции нет в источниках приложения` : '';
  if (view.status === 'found') {
    return `Упоминание найдено: ${view.found} ${pluralSentence(view.found)}${noInstruction}`;
  }
  return `В инструкциях упоминаний не найдено${noInstruction}`;
}

function pluralSentence(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return 'предложений';
  const last = count % 10;
  if (last === 1) return 'предложение';
  if (last >= 2 && last <= 4) return 'предложения';
  return 'предложений';
}

export { pluralSentence };

/** «Инструкция препарата «НУРОФЕН» …»: which instruction was read and what it stands for. */
export function sideHeading(side: SideView): string {
  return `В инструкции «${side.from.label}» — о «${side.to.label}»`;
}

export function sideSourceLine(side: SideView): string {
  const parts: string[] = [];
  if (side.tradeName) parts.push(`инструкция препарата «${displayDrugName(side.tradeName)}»`);
  if (side.source) {
    parts.push(side.source.kindLabel);
    if (side.source.edition) parts.push(side.source.edition);
    if (side.source.publisher) parts.push(`сайт производителя: ${side.source.publisher}`);
    else parts.push('ГРЛС');
    if (side.source.fetchedOn) parts.push(`получена ${side.source.fetchedOn}`);
  }
  return parts.join(' · ');
}

/** The note that the text is one manufacturer's instruction chosen for the substance (ADR-0023). */
export const SUBSTANCE_INSTRUCTION_NOTE =
  'Это инструкция одного из препаратов с этим веществом. Тексты инструкций других производителей могут отличаться.';

export function sideNote(side: SideView): string | null {
  if (side.state === 'not-installed') return 'Инструкция не установлена.';
  if (side.state === 'no-instruction') {
    return `Инструкции «${side.from.label}» нет в источниках приложения.`;
  }
  if (side.changed > 0) {
    return 'Текст инструкции изменился с момента составления указателя: откройте инструкцию.';
  }
  return side.state === 'ready' ? SUBSTANCE_INSTRUCTION_NOTE : null;
}

/** The pairs as print and share text. */
export function printPairs(views: readonly PairView[]): readonly PrintPair[] {
  return views.map(
    (view): PrintPair => ({
      title: pairTitle(view),
      status: pairStatusText(view),
      severity: view.severity ? `${view.severity.label}. ${view.severity.note}` : null,
      sides: view.sides.map(
        (side): PrintSide => ({
          heading: sideHeading(side),
          source: sideSourceLine(side),
          note: sideNote(side),
          quotes: side.quotes.map((quote) => ({
            text: quote.text,
            section: sentenceSectionLabel(quote.flags),
          })),
        }),
      ),
    }),
  );
}
