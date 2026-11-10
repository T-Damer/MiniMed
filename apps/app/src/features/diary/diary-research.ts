/**
 * Study helpers (RESEARCH1): ATC codes kept with a plan item when the doctor picks the medicine
 * from the catalog, and the pseudonymous study code a cohort export names each diary by.
 */

/** ATC codes as a plan item keeps them: upper case, valid level 1–5 codes, no repeats. */
export function studyAtcCodes(codes: readonly string[] | undefined): string[] {
  const valid = /^[A-Z](?:\d{2}(?:[A-Z](?:[A-Z](?:\d{2})?)?)?)?$/u;
  return [
    ...new Set(
      (codes ?? []).map((code) => code.trim().toUpperCase()).filter((code) => valid.test(code)),
    ),
  ].slice(0, 8);
}
