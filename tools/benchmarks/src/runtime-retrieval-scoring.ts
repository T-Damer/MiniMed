export interface RuntimeRetrievalEvaluation {
  readonly edition: string;
  readonly rank: number | null;
  readonly coverage?: 'local' | 'discovery' | 'absent';
  readonly outcome?: 'local-found' | 'discovery-found' | 'miss' | 'absent';
  readonly checks: Readonly<Record<string, boolean>>;
}

export function runtimeRetrievalPassed(row: RuntimeRetrievalEvaluation): boolean {
  return Object.entries(row.checks).every(
    ([check, passed]) => passed || (check === 'recall@5' && row.coverage === 'absent'),
  );
}

export function summarizeRuntimeRetrieval(rows: readonly RuntimeRetrievalEvaluation[]) {
  return Object.fromEntries(
    [...new Set(rows.map((row) => row.edition))].map((edition) => {
      const selected = rows.filter((row) => row.edition === edition);
      const ranked = selected.filter((row) => 'recall@5' in row.checks);
      const downloadChecks = selected.filter((row) => 'downloadTarget' in row.checks);
      return [
        edition,
        {
          evaluated: selected.length,
          retrievalDenominator: ranked.length,
          recallAt5: ranked.length
            ? ranked.filter((row) => row.rank !== null && row.rank <= 5).length / ranked.length
            : null,
          mrrAt5: ranked.length
            ? ranked.reduce((sum, row) => sum + (row.rank && row.rank <= 5 ? 1 / row.rank : 0), 0) /
              ranked.length
            : null,
          coverage: Object.fromEntries(
            ['local', 'discovery', 'absent'].map((coverage) => [
              coverage,
              selected.filter((row) => row.coverage === coverage).length,
            ]),
          ),
          outcomes: Object.fromEntries(
            ['local-found', 'discovery-found', 'miss', 'absent'].map((outcome) => [
              outcome,
              selected.filter((row) => row.outcome === outcome).length,
            ]),
          ),
          coveredRecallAt5: (() => {
            const covered = ranked.filter(
              (row) => row.coverage === 'local' || row.coverage === 'discovery',
            );
            return covered.length
              ? covered.filter((row) => row.rank !== null && row.rank <= 5).length / covered.length
              : null;
          })(),
          contextErrors: selected.filter((row) => row.checks['exactContext'] === false).length,
          downloadCheckDenominator: downloadChecks.length,
          unverifiedDownloadQueries: downloadChecks.filter((row) => !row.checks['downloadTarget'])
            .length,
          failedQueries: selected.filter((row) => !runtimeRetrievalPassed(row)).length,
        },
      ];
    }),
  );
}
