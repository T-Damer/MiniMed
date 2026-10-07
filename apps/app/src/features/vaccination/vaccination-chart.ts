import {
  isAgeRow,
  itemDoseLabel,
  type NationalItem,
  type NationalRow,
  type VaccinationBand,
  type VaccinationCalendar,
  type VaccinationProduct,
} from '@/features/vaccination/vaccination-calendar';

/**
 * Chart of the national calendar (infections × ages), the layout of the official infographic.
 * Everything in it is read from the calendar data: the infections and their order come from
 * `national.chart`, the columns from the age rows, the colour band of a dose from `item.band`, the
 * extent of a category row from `row.ageSpan`. No vaccine is named here.
 */

export type ChartAgeGroup = 'newborn' | 'months' | 'years' | 'adults';

export const CHART_GROUP_LABELS: Readonly<Record<ChartAgeGroup, string>> = {
  newborn: 'Новорождённые',
  months: 'Месяцы',
  years: 'Годы',
  adults: 'Взрослые',
};

/** Legend wording of a colour band; the band itself is declared by the data. */
export const CHART_BAND_LABELS: Readonly<Record<VaccinationBand, string>> = {
  all: 'всем',
  risk: 'группы риска',
  'catch-up': 'ранее не привитым',
};

export const CHART_BANDS: readonly VaccinationBand[] = ['all', 'risk', 'catch-up'];

export interface ChartColumn {
  readonly rowId: string;
  readonly number: string;
  /** The printed age of the row: «3–7 день», «4,5 месяца». */
  readonly ageLabel: string;
  /** Compact header: «24 ч», «3–7 дн.», «4,5», «6–7». */
  readonly shortLabel: string;
  readonly group: ChartAgeGroup;
  /** Age in months at the start of the column; adults start at 18 years. */
  readonly fromMonths: number;
}

export interface ChartDose {
  readonly itemId: string;
  /** `V1`, `RV2`, `V`, `V + RV`. */
  readonly label: string;
  readonly band: VaccinationBand;
  readonly product: VaccinationProduct | null;
  /** The printed wording of the cell, for the tooltip. */
  readonly text: string;
  /** Doses of a category row start the band; the age rows' doses sit in their own column. */
  readonly category: boolean;
}

export interface ChartCell {
  readonly doses: readonly ChartDose[];
  /** Band of a category row that runs through this column, if any. */
  readonly covered: VaccinationBand | null;
}

export interface ChartRow {
  readonly key: string;
  readonly label: string;
  readonly cells: ReadonlyMap<string, ChartCell>;
}

export interface NationalChart {
  readonly columns: readonly ChartColumn[];
  readonly groups: readonly { readonly group: ChartAgeGroup; readonly span: number }[];
  readonly rows: readonly ChartRow[];
  /** Bands that appear in the chart, in legend order. */
  readonly bands: readonly VaccinationBand[];
  /** Products named in the doses, one per code, for the legend. */
  readonly products: readonly VaccinationProduct[];
}

const ADULT_FROM_MONTHS = 18 * 12;
/** A column is counted in whole years from this age on. */
const YEARS_FROM_MONTHS = 24;

function formatNumber(value: number): string {
  return String(value).replace('.', ',');
}

function columnFor(row: NationalRow): ChartColumn {
  const base = { rowId: row.id, number: row.number, ageLabel: row.ageLabel };
  if (!row.age) {
    return { ...base, shortLabel: '18+', group: 'adults', fromMonths: ADULT_FROM_MONTHS };
  }
  const { unit, from, to } = row.age;
  if (unit === 'day-of-life') {
    const shortLabel = from === to ? (from === 1 ? '24 ч' : `${from} дн.`) : `${from}–${to} дн.`;
    return { ...base, shortLabel, group: 'newborn', fromMonths: (from - 1) / 30 };
  }
  if (from >= YEARS_FROM_MONTHS) {
    const years = (value: number): string => formatNumber(value / 12);
    const shortLabel = from === to ? years(from) : `${years(from)}–${years(to)}`;
    return { ...base, shortLabel, group: 'years', fromMonths: from };
  }
  const shortLabel = from === to ? formatNumber(from) : `${formatNumber(from)}–${formatNumber(to)}`;
  return { ...base, shortLabel, group: 'months', fromMonths: from };
}

/** The band of an item at an age in months: a declared age span's band, else the item's own. */
export function itemBandAt(item: NationalItem, months: number | null): VaccinationBand {
  if (months === null) return item.band;
  const span = item.bandSpans?.find(
    (candidate) =>
      months >= candidate.fromMonths &&
      (candidate.toMonths === null || months <= candidate.toMonths),
  );
  return span?.band ?? item.band;
}

function doseFor(item: NationalItem, category: boolean, months: number | null): ChartDose {
  return {
    itemId: item.id,
    label: itemDoseLabel(item),
    band: itemBandAt(item, months),
    product: item.product,
    text: item.text,
    category,
  };
}

/** Builds the chart for every age row of Appendix 1 and every category row's extent. */
export function buildNationalChart(calendar: VaccinationCalendar): NationalChart {
  const rows = calendar.national.rows;
  const columns = rows.filter(isAgeRow).map(columnFor);
  const cells = new Map<
    string,
    Map<string, { doses: ChartDose[]; covered: VaccinationBand | null }>
  >(calendar.national.chart.targets.map((target) => [target.key, new Map()]));
  const cellOf = (target: string, columnId: string) => {
    const byColumn = cells.get(target);
    if (!byColumn) return undefined;
    const existing = byColumn.get(columnId);
    if (existing) return existing;
    const created = { doses: [] as ChartDose[], covered: null as VaccinationBand | null };
    byColumn.set(columnId, created);
    return created;
  };
  for (const row of rows) {
    if (isAgeRow(row)) {
      for (const item of row.items) {
        for (const target of item.targets) {
          cellOf(target, row.id)?.doses.push(doseFor(item, false, null));
        }
      }
      continue;
    }
    const span = row.ageSpan;
    if (!span) continue;
    const covered = columns.filter(
      (column) =>
        column.fromMonths >= span.fromMonths &&
        (span.toMonths === null || column.fromMonths <= span.toMonths),
    );
    const lead = covered[0];
    for (const item of row.items) {
      for (const target of item.targets) {
        for (const column of covered) {
          const cell = cellOf(target, column.rowId);
          if (!cell) continue;
          cell.covered = itemBandAt(item, column.fromMonths);
          if (column === lead) cell.doses.push(doseFor(item, true, column.fromMonths));
        }
      }
    }
  }
  const groups: { group: ChartAgeGroup; span: number }[] = [];
  for (const column of columns) {
    const last = groups[groups.length - 1];
    if (last?.group === column.group) last.span += 1;
    else groups.push({ group: column.group, span: 1 });
  }
  const chartRows = calendar.national.chart.targets.map(
    (target): ChartRow => ({
      key: target.key,
      label: target.label,
      cells: new Map(
        columns.map((column) => [
          column.rowId,
          cells.get(target.key)?.get(column.rowId) ?? { doses: [], covered: null },
        ]),
      ),
    }),
  );
  const used = new Set<VaccinationBand>();
  const products = new Map<string, VaccinationProduct>();
  for (const row of chartRows) {
    for (const cell of row.cells.values()) {
      if (cell.covered) used.add(cell.covered);
      for (const dose of cell.doses) {
        used.add(dose.band);
        if (dose.product) products.set(dose.product.code, dose.product);
      }
    }
  }
  return {
    columns,
    groups,
    rows: chartRows,
    bands: CHART_BANDS.filter((band) => used.has(band)),
    products: [...products.values()],
  };
}
