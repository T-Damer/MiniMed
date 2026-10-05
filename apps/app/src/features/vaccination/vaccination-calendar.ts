import {
  type EpidemicRow,
  type NationalItem,
  type NationalRow,
  type ProcedureItem,
  parseVaccinationCalendar,
  type VaccinationBlock,
  type VaccinationCalendar,
  type VaccinationPopulation,
  type VaccinationSourceFile,
  type VaccinationSourceRef,
  type VaccinationStep,
} from '@localmed/contracts/vaccination-calendar';

import rawCalendar from './data/ru-minzdrav-1122n.json';

export type {
  EpidemicRow,
  NationalItem,
  NationalRow,
  ProcedureItem,
  VaccinationBlock,
  VaccinationCalendar,
  VaccinationPopulation,
  VaccinationSourceFile,
  VaccinationSourceRef,
};

let parsed: VaccinationCalendar | undefined;

/** Validated at the boundary once; a corrupt shipped file fails loudly, never half-renders. */
export function getVaccinationCalendar(): VaccinationCalendar {
  parsed ??= parseVaccinationCalendar(rawCalendar);
  return parsed;
}

/** `стр. 3` or `стр. 4–5`: the PDF pages of the official file a row is printed on. */
export function pdfPagesLabel(pages: readonly number[]): string {
  const first = pages[0];
  const last = pages[pages.length - 1];
  if (first === undefined || last === undefined) return '';
  return first === last ? `стр. ${first}` : `стр. ${first}–${last}`;
}

/** Order number the row is printed in: «1122н» or the amending «677н». */
export function sourceOrderNumber(
  calendar: VaccinationCalendar,
  ref: VaccinationSourceRef,
): string {
  return calendar.sources.find((source) => source.eoNumber === ref.eoNumber)?.orderNumber ?? '';
}

/** Short form of a step for the summary grid: `V1`, `RV2`, `V`, `RV`. */
export function doseLabel(step: VaccinationStep): string {
  const prefix = step.kind === 'vaccination' ? 'V' : 'RV';
  return step.ordinal === null ? prefix : `${prefix}${step.ordinal}`;
}

export function itemDoseLabel(item: NationalItem): string {
  return item.steps.map(doseLabel).join(' + ');
}

/** A row that names one age (or the adult age); the others are category rows with conditions. */
export function isAgeRow(row: NationalRow): boolean {
  return row.age !== null || row.population === 'adults';
}

/** Paragraphs of Appendix 3 that govern an infection, plus the rules of every vaccination. */
export function procedureItemsFor(
  calendar: VaccinationCalendar,
  infectionKey: string,
): readonly ProcedureItem[] {
  return calendar.procedure.items.filter(
    (item) => !item.appliesTo.includes('general') && item.appliesTo.includes(infectionKey),
  );
}

export function generalProcedureItems(calendar: VaccinationCalendar): readonly ProcedureItem[] {
  return calendar.procedure.items.filter((item) => item.appliesTo.includes('general'));
}
