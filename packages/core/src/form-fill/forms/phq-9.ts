import type { FormFillOverlay } from '../adapters';

/**
 * PHQ-9 (`minimed.assessment.phq-9`) from a conversation. Only hints: an answer is a frequency over
 * the last two weeks tied to one question, which word cues cannot pair reliably, so without a model
 * the questionnaire stays empty.
 */
const OVER_TWO_WEEKS = 'как часто за последние 2 недели; null, если частоту не назвали';

export const PHQ_9_OVERLAY: FormFillOverlay = {
  fields: Object.fromEntries(
    ['01', '02', '03', '04', '05', '06', '07', '08', '09'].map((item) => [
      `phq9-${item}`,
      { hint: OVER_TWO_WEEKS },
    ]),
  ),
};
