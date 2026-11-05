import type { FormFillOverlay } from '../adapters';

/**
 * PHQ-9 (`minimed.assessment.phq-9`) from a conversation. No cues: an answer is a frequency over the
 * last two weeks tied to one question, which word cues cannot pair reliably, so without a model the
 * questionnaire stays empty. No hints either: hint words count as the field's subject in the line
 * check, and the questions themselves already say it.
 */
export const PHQ_9_OVERLAY: FormFillOverlay = { fields: {} };
