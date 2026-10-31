/**
 * What the clinical («thinking») search is doing, shown in place in the «Клинический разбор» row
 * (owner 2026-10-31: «show some progress»). Declared as data; the row only renders the label.
 */
export type ClinicalStage = 'analysis' | 'search' | 'refresh';

export const CLINICAL_STAGE_LABEL: Readonly<Record<ClinicalStage, string>> = {
  analysis: 'Разбираем запрос…',
  search: 'Ищем в источниках…',
  refresh: 'Обновляем выдачу…',
};

/** The stage on screen: the query's analysis first, then the search, then a refresh. */
export function clinicalStage(state: {
  readonly analysing: boolean;
  readonly searching: boolean;
  readonly refreshing: boolean;
}): ClinicalStage | undefined {
  if (state.analysing) return 'analysis';
  if (state.searching) return 'search';
  if (state.refreshing) return 'refresh';
  return undefined;
}
