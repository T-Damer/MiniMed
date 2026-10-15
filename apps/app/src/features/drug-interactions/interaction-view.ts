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

/**
 * `missing`: the core answered that the document is not there (its module is not installed).
 * `unreadable`: the core could not read it (a storage failure); the module may well be installed.
 */
export type DocumentState =
  | 'loading'
  | 'missing'
  | 'unreadable'
  | { readonly document: MedicalDocument };

/**
 * `ready`: the instruction is installed and read. `not-installed`: the index knows the instruction
 * but its module is not installed. `unreadable`: the instruction is installed (or may be) and the
 * core failed to read it; never worded as a missing download. `no-instruction`: no instruction of
 * this drug is in the index. `substance`: alcohol has no instruction to read.
 */
export type SideState =
  | 'ready'
  | 'loading'
  | 'not-installed'
  | 'unreadable'
  | 'no-instruction'
  | 'substance';

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
  if (loaded === 'unreadable') return { ...known, state: 'unreadable' };
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
 * The instruction modules a pair is missing: one download for each module that holds the instruction
 * of one of its drugs (QA 0.6.60). Offered also when the index lists no sentence for the side: the
 * index answers for it, but the doctor reads the instruction itself only once it is installed, and a
 * pair must not read as checked while half of its sources are not on the device.
 */
export function pairOfferModules(view: PairView): readonly string[] {
  return [
    ...new Set(
      view.sides.flatMap((side) =>
        side.state === 'not-installed' && side.moduleId ? [side.moduleId] : [],
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

/** The drugs of the sides in a state, as «A, B». */
function namesInState(view: PairView, state: SideState): string {
  return view.sides
    .filter((side) => side.state === state)
    .map((side) => side.from.label)
    .join(', ');
}

/**
 * The status line of a pair. A pair whose instructions are not all there never reads as «nothing
 * found»: a drug without an instruction in the sources is named as unchecked, one whose instruction is
 * not installed says the index answered for it. `listed`: the screen lists the drugs' instruction
 * states right under the line (`sideSourceState`), so the line only says that the check is partial;
 * the print and the share text have no such list and name the drugs in the sentence.
 */
export function pairStatusText(view: PairView, listed = false): string {
  const unchecked = namesInState(view, 'no-instruction');
  const notInstalled = namesInState(view, 'not-installed');
  if (view.status === 'found') {
    const waiting = view.sides.some((side) => side.state === 'not-installed' && side.count > 0);
    const unreadable = view.sides.some((side) => side.state === 'unreadable');
    const shown = view.sides.reduce((total, side) => total + side.quotes.length, 0);
    const base = `В инструкциях ${view.found} ${pluralSentence(view.found)} об этом сочетании`;
    const noInstruction =
      unchecked === '' || listed ? '' : `; в источниках приложения нет инструкции: ${unchecked}`;
    // The index knows the sentences before their instructions are installed: say when they appear.
    // An instruction the core failed to read is not a download to wait for.
    const pending =
      shown > 0
        ? ''
        : unreadable
          ? ' — установленную инструкцию сейчас не удалось прочитать'
          : waiting
            ? ' — они появятся после скачивания инструкций'
            : '';
    return `${base}${pending}${noInstruction}`;
  }
  if (unchecked !== '') {
    return listed
      ? 'В доступных инструкциях упоминаний не найдено; проверено не полностью'
      : `В доступных инструкциях упоминаний не найдено; не проверено — в источниках приложения нет инструкции: ${unchecked}${notInstalled === '' ? '' : `; инструкция не установлена: ${notInstalled} (по указателю приложения упоминаний нет)`}`;
  }
  if (notInstalled !== '') {
    return listed
      ? 'По указателю приложения упоминаний не найдено'
      : `По указателю приложения упоминаний не найдено; инструкция не установлена: ${notInstalled}`;
  }
  return 'В инструкциях упоминаний не найдено';
}

/**
 * What the pair knows about one drug's instruction, for the small list under the status line
 * (QA 0.6.60): installed, not installed (the download is offered), or not in the sources at all.
 */
export function sideSourceState(side: SideView): string {
  switch (side.state) {
    case 'ready':
      return 'инструкция установлена';
    case 'loading':
      return 'читаем инструкцию…';
    case 'not-installed':
      return 'инструкция не установлена';
    case 'no-instruction':
      return 'нет инструкции в источниках приложения';
    case 'substance':
      return '';
  }
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

/**
 * Which instruction was read and what was looked for in it. The names stay in the nominative after
 * a colon: a drug name is never declined («упоминание: «Симвастатин»»), so no case can come out wrong.
 */
export function sideHeading(side: SideView): string {
  return `В инструкции «${side.from.label}» — упоминание: «${side.to.label}»`;
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

/**
 * What is wrong with reading one side, if anything. That the text is one manufacturer's instruction
 * chosen for the substance (ADR-0023) is said once, in the tool's «?» help and in the print/share
 * notice, never under every drug.
 */
export function sideNote(side: SideView): string | null {
  if (side.state === 'not-installed') return 'Инструкция не установлена.';
  if (side.state === 'unreadable') return 'Не удалось прочитать установленную инструкцию.';
  if (side.state === 'no-instruction') {
    return `Нет инструкции в источниках приложения: «${side.from.label}».`;
  }
  if (side.changed > 0) {
    return 'Текст инструкции изменился с момента составления указателя: откройте инструкцию.';
  }
  return null;
}

/**
 * «через фенобарбитал (снотворное)»: the sentence reaches the drug only through an additional
 * class one of its components brings (CLS1), not through the drug's own substance or class.
 */
export function quoteViaText(quote: Pick<Quote, 'secondary'>): string | null {
  return quote.secondary ? `через ${quote.secondary.via} (${quote.secondary.label})` : null;
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
          quotes: side.quotes.map((quote) => {
            const via = quoteViaText(quote);
            return {
              text: quote.text,
              section: via
                ? `${sentenceSectionLabel(quote.flags)} · ${via}`
                : sentenceSectionLabel(quote.flags),
            };
          }),
        }),
      ),
    }),
  );
}
