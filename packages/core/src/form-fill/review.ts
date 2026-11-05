import type {
  FormFillDecision,
  FormFillProposal,
  FormFillResult,
  FormFillReview,
  FormFillValue,
} from '@localmed/contracts';

/**
 * The doctor's review of a filled form (FORMFILL1): every proposed value is pending until accepted
 * or turned down; only accepted values reach the form.
 */

export function emptyFormFillReview(result: FormFillResult): FormFillReview {
  return { formId: result.formId, decisions: {} };
}

export function decideFormFillValue(
  review: FormFillReview,
  fieldId: string,
  decision: FormFillDecision | null,
): FormFillReview {
  const decisions = new Map(Object.entries(review.decisions));
  if (decision === null) decisions.delete(fieldId);
  else decisions.set(fieldId, decision);
  return { ...review, decisions: Object.fromEntries(decisions) };
}

export interface FormFillReviewItem {
  readonly fieldId: string;
  readonly proposal: FormFillProposal;
  readonly decision: FormFillDecision | null;
}

/** Proposed values in form order with the doctor's decision so far. */
export function formFillReviewItems(
  result: FormFillResult,
  review: FormFillReview,
): FormFillReviewItem[] {
  const decisions = new Map(Object.entries(review.decisions));
  return Object.entries(result.fields).flatMap(([fieldId, proposal]) =>
    proposal ? [{ fieldId, proposal, decision: decisions.get(fieldId) ?? null }] : [],
  );
}

/** What goes into the form: accepted values only. */
export function acceptedFormFillValues(
  result: FormFillResult,
  review: FormFillReview,
): ReadonlyMap<string, FormFillValue> {
  return new Map(
    formFillReviewItems(result, review)
      .filter((item) => item.decision === 'accepted')
      .map((item) => [item.fieldId, item.proposal.value]),
  );
}
