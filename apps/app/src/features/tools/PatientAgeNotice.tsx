import type { ToolAgeScope } from '@localmed/contracts';
import { type JSX, Show } from 'solid-js';
import { patientAgeMismatch } from '@/features/tools/patient-age-notice';

import '@/features/tools/tool-age.css';

/** Under the patient field of a tool: says when the chosen patient's age is outside the tool's scope. */
export function PatientAgeNotice(props: {
  readonly scope: ToolAgeScope;
  readonly birthDate: string | undefined;
}): JSX.Element {
  const message = () =>
    patientAgeMismatch(props.scope, props.birthDate, new Date().toISOString().slice(0, 10));
  return (
    <Show when={message()}>
      {(text) => (
        <p class="patient-age-notice" role="status" data-testid="patient-age-notice">
          {text()}
        </p>
      )}
    </Show>
  );
}
