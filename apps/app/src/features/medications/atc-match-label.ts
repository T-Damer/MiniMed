import type { SearchAtcMatch } from '@localmed/contracts';

export interface AtcMatchLabel {
  readonly code: string;
  /** «в реестре: L03AX» beside an agreed code, as the drug screen words it; null otherwise. */
  readonly registryNote: string | null;
}

/**
 * What the result card says about the ATC code that found a drug: «J05AX13» alone, or
 * «J05AX13 · в реестре: L03AX» where the registry holds only a group stub (ATC3, same wording as
 * the drug screen's chip).
 */
export function atcMatchLabel(match: SearchAtcMatch): AtcMatchLabel {
  const registryNote = match.registryCode ? `в реестре: ${match.registryCode}` : null;
  return {
    code: match.code,
    registryNote,
  };
}
