import {
  isAgeRow,
  itemDoseLabel,
  type NationalItem,
  type NationalRow,
  type VaccinationCalendar,
} from '@/features/vaccination/vaccination-calendar';

export interface GridColumn {
  readonly rowId: string;
  readonly number: string;
  readonly label: string;
}

export interface GridDose {
  /** `V1`, `RV2`, `V`, `RV`; paired steps read `V + RV`. */
  readonly label: string;
  readonly qualifier: string | null;
  readonly condition: string | null;
  /** The printed wording of the cell this dose comes from. */
  readonly text: string;
}

export interface GridRow {
  readonly infectionKey: string;
  readonly infection: string;
  /** Doses by column row id; a column without an entry has nothing in the order. */
  readonly cells: ReadonlyMap<string, readonly GridDose[]>;
}

export interface SummaryGrid {
  readonly columns: readonly GridColumn[];
  readonly rows: readonly GridRow[];
  /** Rows 16–19: vaccinations given by category, not by age. Shown below the grid in full. */
  readonly categoryRows: readonly NationalRow[];
}

function dose(item: NationalItem): GridDose {
  return {
    label: itemDoseLabel(item),
    qualifier: item.qualifier,
    condition: item.condition,
    text: item.text,
  };
}

/**
 * Infection × age grid of the national calendar, rebuilt from the printed rows of Appendix 1 (the
 * order prints it by age, vaccine by vaccine). Every vaccination of an age row appears exactly once.
 */
export function buildSummaryGrid(calendar: VaccinationCalendar): SummaryGrid {
  const ageRows = calendar.national.rows.filter(isAgeRow);
  const infections: { key: string; name: string }[] = [];
  const cells = new Map<string, Map<string, GridDose[]>>();
  for (const row of ageRows) {
    for (const item of row.items) {
      if (!infections.some((entry) => entry.key === item.infectionKey)) {
        infections.push({ key: item.infectionKey, name: item.infection });
      }
      const byColumn = cells.get(item.infectionKey) ?? new Map<string, GridDose[]>();
      const doses = byColumn.get(row.id) ?? [];
      doses.push(dose(item));
      byColumn.set(row.id, doses);
      cells.set(item.infectionKey, byColumn);
    }
  }
  return {
    columns: ageRows.map((row) => ({ rowId: row.id, number: row.number, label: row.ageLabel })),
    rows: infections.map((entry) => ({
      infectionKey: entry.key,
      infection: entry.name,
      cells: cells.get(entry.key) ?? new Map<string, GridDose[]>(),
    })),
    categoryRows: calendar.national.rows.filter((row) => !isAgeRow(row)),
  };
}

/** Number of vaccinations in the grid; equals the items of the age rows. */
export function gridDoseCount(grid: SummaryGrid): number {
  return grid.rows.reduce(
    (total, row) => total + [...row.cells.values()].reduce((sum, doses) => sum + doses.length, 0),
    0,
  );
}
