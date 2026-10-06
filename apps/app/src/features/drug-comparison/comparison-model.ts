/**
 * The print and share model of a comparison (CMP1), built from the same views the screen draws.
 * Pure: every text here is a registry value, a quoted sentence of an installed instruction, or one
 * of the fixed notices; nothing is worded as an advantage of one drug over another.
 */
import type { PrintPair } from '@/features/drug-interactions/interaction-print';
import { NOTHING_SAID_TEXT } from '@/features/medication-safety/safety-view';
import type { ComparisonPrintModel, PrintSection } from './comparison-print';
import type { RegistryCell, RegistryRowSpec } from './comparison-registry';
import type { SafetyRowView } from './comparison-safety';
import {
  type ColumnView,
  columnSourceLine,
  isDifference,
  type QuoteRowView,
  rowSummary,
  type SectionRowView,
} from './comparison-view';

export const NO_LINE_TEXT = 'В прочитанной инструкции такой строки нет';
export const NOT_READ_TEXT = 'Инструкция не прочитана';

/** The name a column goes by in marks and print: the product asked for, or the substance. */
export function columnName(column: ColumnView): string {
  return column.item.label;
}

export function columnSourceText(column: ColumnView): string {
  if (column.state === 'ready') return columnSourceLine(column);
  if (column.state === 'no-instruction')
    return 'инструкции этого вещества нет в источниках приложения';
  if (column.state === 'not-installed') return 'инструкция не установлена';
  return 'инструкция читается';
}

export function registryCellText(cell: RegistryCell): string {
  return [...cell.lines, ...cell.more].join('\n');
}

export function sectionForPrint(
  row: SectionRowView,
  columns: readonly ColumnView[],
  onlyDifferences: boolean,
): PrintSection {
  const clusters = row.clusters.filter((cluster) => !onlyDifferences || isDifference(cluster));
  return {
    title: row.title,
    summary: rowSummary(row, columns),
    clusters: clusters.map((cluster) => ({
      label: cluster.label,
      texts: cluster.cells.map((cell) => cell?.text ?? null),
    })),
    missing: columns.flatMap((column, position) =>
      column.state === 'ready' && row.columns[position]?.hasSection === false
        ? [columnName(column)]
        : [],
    ),
  };
}

export function printModelOf(input: {
  readonly columns: readonly ColumnView[];
  readonly registry: readonly {
    readonly spec: RegistryRowSpec;
    readonly cells: readonly RegistryCell[];
  }[];
  readonly quoteRows: readonly QuoteRowView[];
  readonly safetyRows: readonly SafetyRowView[];
  readonly sectionRows: readonly SectionRowView[];
  readonly onlyDifferences: boolean;
  readonly interactions: readonly PrintPair[];
  readonly registrySource: string;
}): ComparisonPrintModel {
  const { columns } = input;
  const readText = (column: ColumnView | undefined, text: string | null): string =>
    column?.state !== 'ready' ? NOT_READ_TEXT : (text ?? NO_LINE_TEXT);
  return {
    columns: columns.map((column) => ({
      name: columnName(column),
      source: columnSourceText(column),
    })),
    groups: [
      {
        title: 'Данные реестров',
        source: input.registrySource,
        rows: input.registry.map(({ spec, cells }) => ({
          title: spec.title,
          cells: cells.map(registryCellText),
        })),
      },
      {
        title: 'Из инструкций',
        source: 'Строки инструкций дословно; в каждом столбце читается инструкция, указанная выше.',
        rows: [
          ...input.quoteRows.map((row) => ({
            title: row.title,
            cells: row.blocks.map((block, position) =>
              readText(columns[position], block?.text ?? null),
            ),
          })),
          ...input.safetyRows.map((row) => ({
            title: row.title,
            cells: row.cells.map((cell) => {
              if (cell.state === 'not-read') return NOT_READ_TEXT;
              if (cell.state === 'nothing-said') return NOTHING_SAID_TEXT;
              return [
                ...(cell.numbers.length > 0 ? [`В тексте: ${cell.numbers.join('; ')}`] : []),
                ...cell.quotes.map((quote) => `[${quote.originLabel}] ${quote.fullText}`),
                ...(cell.hidden > 0 ? [`ещё предложений: ${cell.hidden}`] : []),
              ].join('\n');
            }),
          })),
        ],
      },
    ],
    sections: input.sectionRows.map((row) => sectionForPrint(row, columns, input.onlyDifferences)),
    interactions: input.interactions,
    onlyDifferences: input.onlyDifferences,
    registrySource: input.registrySource,
  };
}
