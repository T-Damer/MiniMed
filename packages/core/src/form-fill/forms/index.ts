import type { FormFillOverlay } from '../adapters';
import { FORM_070U_OVERLAY } from './070u';
import { CHA2DS2_VASC_OVERLAY } from './cha2ds2-vasc';
import { PHQ_9_OVERLAY } from './phq-9';

/** Overlays by source schema id (tool id, official form id). */
export const FORM_FILL_OVERLAYS: ReadonlyMap<string, FormFillOverlay> = new Map([
  ['minimed.calculator.cha2ds2-vasc', CHA2DS2_VASC_OVERLAY],
  ['minimed.assessment.phq-9', PHQ_9_OVERLAY],
  ['ru.minzdrav.274n.070u', FORM_070U_OVERLAY],
]);

export function formFillOverlayFor(sourceId: string): FormFillOverlay | undefined {
  return FORM_FILL_OVERLAYS.get(sourceId);
}
