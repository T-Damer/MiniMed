import type { JSX } from 'solid-js';

/** The steps of the doctor's patient form, top to bottom; the preview's rows point at them. */
export type PatientStep = 'profile' | 'past' | 'now' | 'marks' | 'visits' | 'contact';

const stepId = (step: PatientStep): string => `patient-step-${step}`;

/**
 * Scrolls the form to a step and puts the screen reader there, without a second jump from focus.
 * Called when a row of the patient's preview is tapped.
 */
export function focusPatientStep(step: PatientStep): void {
  const heading = document.getElementById(`${stepId(step)}-title`);
  if (!heading) return;
  heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
  heading.focus({ preventScroll: true });
}

/**
 * One numbered card of the doctor's form: a short heading and one plain line on what it is for —
 * the built-in guidance (owner 2026-11-10), no separate tour.
 */
export function FormStep(props: {
  readonly step: PatientStep;
  readonly number: number;
  readonly title: string;
  readonly hint: string;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <section
      class="form-step"
      id={stepId(props.step)}
      aria-labelledby={`${stepId(props.step)}-title`}
    >
      <header class="form-step__head">
        <span class="form-step__number" aria-hidden="true">
          {props.number}
        </span>
        <div class="form-step__heading">
          <h2 class="form-step__title" id={`${stepId(props.step)}-title`} tabindex="-1">
            {props.title}
          </h2>
          <p class="form-step__hint">{props.hint}</p>
        </div>
      </header>
      <div class="form-step__body">{props.children}</div>
    </section>
  );
}
