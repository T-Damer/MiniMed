/**
 * What the comparison tool shows (CMP1). Pure: the workspace passes in the index, the instructions
 * it has read and the drugs chosen; the same view feeds the screen, the print and the share text,
 * so they can never disagree.
 *
 * Nothing here judges: a row says what each instruction states, a group of matched statements says
 * which instructions state it, and the words that differ are marked. No summary, no «лучше/хуже».
 */
import type { MedicalDocument } from '@localmed/contracts';
import { displayDrugName } from '@/features/medications/drug-screen';
import {
  type InstructionSourceInfo,
  instructionSourceInfo,
} from '@/features/medications/instruction-source';
import { pluralRu } from '@/i18n/labels';
import {
  type AssetDocument,
  type ComparisonIndex,
  documentKind,
  formClass,
  rowCount,
} from './comparison-index';
import {
  type ClusterKind,
  type ColumnUnits,
  clusterKind,
  clusterUnits,
  type DiffSegment,
  diffSegments,
  ownNameStems,
  type UnitCluster,
} from './comparison-match';
import { MAX_COMPARED_NAMES } from './comparison-query';
import {
  type ExtractedRow,
  extractQuoteBlock,
  extractRows,
  QUOTE_ROWS,
  type QuoteBlock,
  SECTION_ROWS,
  type SectionUnit,
} from './comparison-sections';

export const MAX_DRUGS = MAX_COMPARED_NAMES;
export const MIN_DRUGS = 2;

/** The notice shown above every comparison, in the screen, the print and the share text. */
/** The notice above the empty tool: one line; the full one closes the results and the print. */
export const COMPARISON_NOTICE_SHORT =
  'Сравнение текстов инструкций, а не клиническая рекомендация: решение принимает врач.';

export const COMPARISON_NOTICE =
  'Сравнение текстов инструкций, а не клиническая рекомендация. Приложение не оценивает, какой препарат лучше или хуже: оно показывает, что написано в инструкциях и где эти тексты совпадают или различаются. Решение принимает врач по полному тексту инструкций и клинической картине.';

/** One drug of the comparison. */
export interface CompareItem {
  /** ЕСКЛП МНН card slug: the identity of the item within the tool. */
  readonly id: string;
  /** Index into the asset's `cards`. */
  readonly card: number;
  /** As the doctor reads it: «Ибупрофен», or «Нурофен · Ибупрофен» for a product. */
  readonly label: string;
  /** The trade name the doctor asked for, when the search found a product. */
  readonly product: string | null;
  /** The word the doctor typed, when it differs from the label. */
  readonly typed?: string | undefined;
}

export type DocumentState = 'loading' | 'missing' | { readonly document: MedicalDocument };

/* ------------------------------------------------------------------------------------------ */
/* Which instruction is read                                                                   */
/* ------------------------------------------------------------------------------------------ */

function normalizeName(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[®™]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The instructions of the item's card, the one of the product the doctor asked for first. */
export function instructionsOf(index: ComparisonIndex, item: CompareItem): readonly string[] {
  const ids = index.documentsOfCard.get(item.card) ?? [];
  if (!item.product) return ids;
  const wanted = normalizeName(item.product);
  const own = ids.filter((id) => {
    const name = index.asset.documents[id]?.t;
    return name !== null && name !== undefined && normalizeName(name) === wanted;
  });
  return own.length > 0 ? [...own, ...ids.filter((id) => !own.includes(id))] : ids;
}

/** True when the first instruction of the item is of the very product the doctor asked for. */
export function readsOwnProduct(index: ComparisonIndex, item: CompareItem, id: string): boolean {
  if (!item.product) return false;
  const name = index.asset.documents[id]?.t;
  return name !== null && name !== undefined && normalizeName(name) === normalizeName(item.product);
}

/**
 * The instruction to read for every item. A chosen instruction (`overrides`) is kept. For the rest:
 * the dosage-form class (the first word of the form: таблетки, капсулы, раствор…) that every item
 * has an instruction for and that gives the most quoted sections (then the one with the most
 * instructions), so a tablet is read against a tablet; where no such class exists, or it would cost more than two quoted sections against each
 * drug's own best instruction, every drug's best instruction (`compareInstructions`) is read.
 * Pure: the same asset and items give the same choice.
 */
export function chooseDocuments(
  index: ComparisonIndex,
  items: readonly CompareItem[],
  overrides: ReadonlyMap<string, string>,
): ReadonlyMap<string, string | null> {
  const chosen = new Map<string, string | null>();
  const flexible: { readonly item: CompareItem; readonly ids: readonly string[] }[] = [];
  const classOf = (id: string): string => formClass(formOfDocument(index, id));
  const fixedClasses = new Set<string>();
  const rows = (id: string): number => rowCount(index.asset.documents[id]?.y ?? 0);
  for (const item of items) {
    const pinned = overrides.get(item.id);
    if (pinned && index.asset.documents[pinned]) {
      chosen.set(item.id, pinned);
      fixedClasses.add(classOf(pinned));
      continue;
    }
    const ids = instructionsOf(index, item);
    const first = ids[0];
    if (first === undefined) {
      chosen.set(item.id, null);
    } else if (readsOwnProduct(index, item, first)) {
      // A product the doctor asked for keeps its own instruction, whatever the others are.
      chosen.set(item.id, first);
      fixedClasses.add(classOf(first));
    } else flexible.push({ item, ids });
  }

  const bestOfClass = (ids: readonly string[], cls: string): string | undefined =>
    ids.find((id) => classOf(id) === cls);
  let common: string | null = null;
  if (flexible.length > 0 && items.length > 1) {
    const sums = new Map<string, { readonly sum: number; readonly popularity: number }>();
    const classes = new Set(flexible.flatMap(({ ids }) => ids.map(classOf)));
    for (const cls of classes) {
      if (cls === '' || (fixedClasses.size === 1 && !fixedClasses.has(cls))) continue;
      let sum = 0;
      let popularity = 0;
      let everyone = true;
      for (const { ids } of flexible) {
        const id = bestOfClass(ids, cls);
        if (id === undefined) {
          everyone = false;
          break;
        }
        sum += rows(id);
        popularity += ids.filter((other) => classOf(other) === cls).length;
      }
      if (everyone) sums.set(cls, { sum, popularity });
    }
    const ownSum = flexible.reduce((total, { ids }) => total + rows(ids[0] as string), 0);
    // Most quoted sections first, then the form with the most instructions (the usual one).
    const [top] = [...sums.entries()].toSorted(
      ([leftClass, left], [rightClass, right]) =>
        right.sum - left.sum ||
        right.popularity - left.popularity ||
        leftClass.localeCompare(rightClass, 'ru'),
    );
    if (top && top[1].sum >= ownSum - 2) common = top[0];
  }
  for (const { item, ids } of flexible) {
    chosen.set(item.id, (common ? bestOfClass(ids, common) : undefined) ?? ids[0] ?? null);
  }
  return chosen;
}

function formOfDocument(index: ComparisonIndex, id: string): string | null {
  const document = index.asset.documents[id];
  return document && document.f >= 0 ? (index.asset.forms[document.f] ?? null) : null;
}

export interface InstructionChoice {
  readonly documentId: string;
  /** «таблетки · Нурофен · инструкция». */
  readonly label: string;
  readonly selected: boolean;
}

const KIND_LABELS = {
  ohlp: 'ОХЛП',
  'national-instruction': 'инструкция',
  leaflet: 'листок-вкладыш',
  unknown: 'инструкция ГРЛС',
} as const;

function choiceLabel(index: ComparisonIndex, id: string, document: AssetDocument): string {
  const form = formOfDocument(index, id) ?? 'форма не указана';
  const parts = [form];
  if (document.t) parts.push(displayDrugName(document.t));
  parts.push(KIND_LABELS[documentKind(document)]);
  if (document.s === 1) parts.push('сайт производителя');
  return parts.join(' · ');
}

/** The other instructions of the item's card the doctor can switch to: the best of each form class. */
export function choicesOf(
  index: ComparisonIndex,
  item: CompareItem,
  selectedId: string | null,
): readonly InstructionChoice[] {
  const ids = instructionsOf(index, item);
  const seen = new Set<string>();
  const choices: InstructionChoice[] = [];
  for (const id of ids) {
    const document = index.asset.documents[id];
    if (!document) continue;
    const key = `${formClass(formOfDocument(index, id))}|${document.k}|${document.t ?? ''}`;
    if (id !== selectedId && seen.has(key)) continue;
    seen.add(key);
    choices.push({
      documentId: id,
      label: choiceLabel(index, id, document),
      selected: id === selectedId,
    });
    if (choices.length >= 12) break;
  }
  if (selectedId && !choices.some((choice) => choice.selected)) {
    const document = index.asset.documents[selectedId];
    if (document) {
      choices.unshift({
        documentId: selectedId,
        label: choiceLabel(index, selectedId, document),
        selected: true,
      });
    }
  }
  return choices;
}

/* ------------------------------------------------------------------------------------------ */
/* Columns                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** `ready`: read; `loading`; `not-installed`: known, module missing; `no-instruction`: none in the sources. */
export type ColumnState = 'ready' | 'loading' | 'not-installed' | 'no-instruction';

export interface ColumnView {
  readonly item: CompareItem;
  readonly position: number;
  readonly state: ColumnState;
  readonly documentId: string | null;
  readonly moduleId: string | null;
  readonly tradeName: string | null;
  readonly dosageForm: string | null;
  readonly kindLabel: string | null;
  readonly source: InstructionSourceInfo | null;
  /** True when the instruction is the one of the product the doctor asked for. */
  readonly own: boolean;
  readonly choices: readonly InstructionChoice[];
}

export function columnViews(
  index: ComparisonIndex,
  items: readonly CompareItem[],
  chosen: ReadonlyMap<string, string | null>,
  documents: ReadonlyMap<string, DocumentState>,
): readonly ColumnView[] {
  return items.map((item, position): ColumnView => {
    const id = chosen.get(item.id) ?? null;
    const document = id ? index.asset.documents[id] : undefined;
    const base = {
      item,
      position,
      documentId: id,
      moduleId: document ? (index.asset.modules[document.m] ?? null) : null,
      tradeName: document?.t ? displayDrugName(document.t) : null,
      dosageForm: id ? formOfDocument(index, id) : null,
      kindLabel: document ? KIND_LABELS[documentKind(document)] : null,
      own: id ? readsOwnProduct(index, item, id) : false,
      choices: choicesOf(index, item, id),
    };
    if (!id || !document) return { ...base, state: 'no-instruction', source: null };
    const loaded = documents.get(id);
    if (loaded === undefined || loaded === 'loading')
      return { ...base, state: 'loading', source: null };
    if (loaded === 'missing') return { ...base, state: 'not-installed', source: null };
    return { ...base, state: 'ready', source: instructionSourceInfo(loaded.document) };
  });
}

/** «Инструкция препарата «Нурофен» · таблетки · инструкция · Изм. № 0 · ГРЛС · получена 09.09.2026». */
export function columnSourceLine(column: ColumnView): string {
  const parts: string[] = [];
  if (column.tradeName) parts.push(`инструкция препарата «${column.tradeName}»`);
  if (column.dosageForm) parts.push(column.dosageForm);
  if (column.source) {
    parts.push(column.source.kindLabel);
    if (column.source.edition) parts.push(column.source.edition);
    parts.push(column.source.publisher ? `сайт производителя: ${column.source.publisher}` : 'ГРЛС');
    if (column.source.fetchedOn) parts.push(`получена ${column.source.fetchedOn}`);
  }
  const text = parts.join(' · ');
  return text.charAt(0).toLocaleUpperCase('ru-RU') + text.slice(1);
}

export const SUBSTANCE_INSTRUCTION_NOTE =
  'Это инструкция одного из препаратов с этим веществом. Тексты инструкций других производителей могут отличаться.';

/* ------------------------------------------------------------------------------------------ */
/* Quoted section rows                                                                         */
/* ------------------------------------------------------------------------------------------ */

export interface CellView {
  readonly key: string;
  readonly text: string;
  /** The text with the words that differ from the matched statements marked. */
  readonly segments: readonly DiffSegment[];
  readonly anchor: string | null;
  /** Title of the section the statement stands in. */
  readonly sectionTitle: string;
}

export interface ClusterView {
  readonly kind: ClusterKind;
  /** The matched statements say the same after normalisation. */
  readonly identical: boolean;
  /** «у обоих», «у Нурофен; у других совпадения нет», «у Ибупрофен и Парацетамол». */
  readonly label: string;
  /** One cell per column; null where the drug does not state it. */
  readonly cells: readonly (CellView | null)[];
}

export interface RowColumnFacts {
  /** The instruction was read and this section has text. */
  readonly hasSection: boolean;
  readonly units: number;
  /** Statements beyond the comparison limit. */
  readonly cut: number;
  readonly anchor: string | null;
}

export interface SectionRowView {
  readonly id: string;
  readonly title: string;
  readonly columns: readonly RowColumnFacts[];
  /** Marks are given only when at least two instructions were read. */
  readonly compared: boolean;
  readonly clusters: readonly ClusterView[];
  readonly counts: {
    readonly identical: number;
    readonly similar: number;
    /** Statements only in one drug, by column. */
    readonly only: readonly number[];
    /** Statements in some drugs but not all (three or four drugs). */
    readonly partial: number;
  };
}

/** A cluster that is not «the same words in every drug»: what «Показать только различия» keeps. */
export function isDifference(cluster: ClusterView): boolean {
  return !(cluster.kind === 'shared' && cluster.identical);
}

/** Display names in a mark: the product or the substance, short. */
function markName(item: CompareItem): string {
  return item.product ? displayDrugName(item.product) : item.label;
}

export function clusterLabel(
  kind: ClusterKind,
  identical: boolean,
  names: readonly string[],
  drugCount: number,
): string {
  let text: string;
  if (kind === 'shared') text = drugCount === 2 ? 'у обоих' : 'у всех';
  // Not «только у X»: a statement worded differently in another instruction is not matched, so the
  // mark says only what was checked — no matching statement in the other texts.
  else if (kind === 'only') text = `у ${names[0] ?? ''}; у других совпадения нет`;
  else text = `у ${names.join(', ')}`;
  return kind !== 'only' && !identical ? `${text}, формулировки различаются` : text;
}

interface ReadColumn {
  readonly position: number;
  readonly item: CompareItem;
  readonly rows: ReadonlyMap<string, ExtractedRow>;
  readonly own: ReadonlySet<string>;
}

function clusterView(
  cluster: UnitCluster,
  read: readonly ReadColumn[],
  rowId: string,
  totalColumns: number,
): ClusterView {
  const unitsOf = (drug: number): readonly SectionUnit[] =>
    read[drug]?.rows.get(rowId)?.units ?? [];
  const members = cluster.members.map((member) => ({
    ...member,
    unit: unitsOf(member.drug)[member.unit] as SectionUnit,
  }));
  const cells: (CellView | null)[] = Array.from({ length: totalColumns }, () => null);
  for (const member of members) {
    const column = read[member.drug] as ReadColumn;
    const others = members.filter((other) => other !== member);
    const segments =
      cluster.identical || others.length === 0
        ? [{ text: member.unit.text, differs: false }]
        : diffSegments(
            member.unit,
            others.map((other) => other.unit),
            column.own,
            others.map((other) => (read[other.drug] as ReadColumn).own),
          );
    cells[column.position] = {
      key: member.unit.key,
      text: member.unit.text,
      segments,
      anchor: member.unit.anchor,
      sectionTitle: extractedTitle(read, member.drug, rowId, member.unit.part),
    };
  }
  const kind = clusterKind(cluster, read.length);
  const names = cluster.members.map((member) => markName((read[member.drug] as ReadColumn).item));
  return {
    kind,
    identical: cluster.identical,
    label: clusterLabel(kind, cluster.identical, names, read.length),
    cells,
  };
}

function extractedTitle(
  read: readonly ReadColumn[],
  drug: number,
  rowId: string,
  part: number,
): string {
  return read[drug]?.rows.get(rowId)?.parts[part]?.title ?? '';
}

export function sectionRowViews(
  columns: readonly ColumnView[],
  extracted: ReadonlyMap<number, ReadonlyMap<string, ExtractedRow>>,
  ownNames: ReadonlyMap<number, readonly string[]>,
): readonly SectionRowView[] {
  const read: ReadColumn[] = columns.flatMap((column) => {
    const rows = extracted.get(column.position);
    return column.state === 'ready' && rows
      ? [
          {
            position: column.position,
            item: column.item,
            rows,
            own: ownNameStems(ownNames.get(column.position) ?? []),
          },
        ]
      : [];
  });
  return SECTION_ROWS.map((spec): SectionRowView => {
    const facts = columns.map((column): RowColumnFacts => {
      const row = extracted.get(column.position)?.get(spec.id);
      return {
        hasSection: column.state === 'ready' && (row?.units.length ?? 0) > 0,
        units: row?.units.length ?? 0,
        cut: row?.cut ?? 0,
        anchor: row?.anchor ?? null,
      };
    });
    const compared = read.length >= MIN_DRUGS;
    const clusters: ClusterView[] = [];
    if (compared) {
      const inputs: ColumnUnits[] = read.map((column, drug) => ({
        drug,
        units: column.rows.get(spec.id)?.units ?? [],
        ownStems: column.own,
      }));
      for (const cluster of clusterUnits(inputs)) {
        clusters.push(clusterView(cluster, read, spec.id, columns.length));
      }
    }
    const only = columns.map(() => 0);
    let identical = 0;
    let similar = 0;
    let partial = 0;
    for (const cluster of clusters) {
      if (cluster.kind === 'only') {
        const position = cluster.cells.findIndex((cell) => cell !== null);
        only[position] = (only[position] ?? 0) + 1;
      } else if (cluster.kind === 'partial') partial += 1;
      else if (cluster.identical) identical += 1;
      else similar += 1;
    }
    return {
      id: spec.id,
      title: spec.title,
      columns: facts,
      compared,
      clusters,
      counts: { identical, similar, only, partial },
    };
  });
}

/** «одинаковых: 8 · похожих, с различиями: 2 · без совпадения у других — Нурофен: 3 · …». */
export function rowSummary(row: SectionRowView, columns: readonly ColumnView[]): string {
  if (!row.compared) return '';
  const parts: string[] = [];
  const shared = row.counts.identical;
  parts.push(`одинаковых: ${shared}`);
  if (row.counts.similar > 0) parts.push(`похожих, с различиями: ${row.counts.similar}`);
  if (row.counts.partial > 0) parts.push(`у части препаратов: ${row.counts.partial}`);
  columns.forEach((column, position) => {
    const count = row.counts.only[position] ?? 0;
    if (count > 0) parts.push(`без совпадения у других — ${markName(column.item)}: ${count}`);
  });
  return parts.join(' · ');
}

export function unitsWord(count: number): string {
  return pluralRu(count, 'пункт', 'пункта', 'пунктов');
}

/* ------------------------------------------------------------------------------------------ */
/* Quoted short lines                                                                          */
/* ------------------------------------------------------------------------------------------ */

export interface QuoteRowView {
  readonly id: string;
  readonly title: string;
  /** One block per column; null where the instruction has no such line (or was not read). */
  readonly blocks: readonly (QuoteBlock | null)[];
}

export function quoteRowViews(
  columns: readonly ColumnView[],
  documents: ReadonlyMap<number, MedicalDocument>,
): readonly QuoteRowView[] {
  return QUOTE_ROWS.map((spec) => ({
    id: spec.id,
    title: spec.title,
    blocks: columns.map((column) => {
      const document = documents.get(column.position);
      return column.state === 'ready' && document ? extractQuoteBlock(document, spec) : null;
    }),
  }));
}

export { extractRows };
