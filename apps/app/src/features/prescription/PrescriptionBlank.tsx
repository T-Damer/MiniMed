import type { FormSchema } from '@localmed/contracts';
import { createMemo, createSignal, type JSX, Show } from 'solid-js';

import { SegmentedControl } from '@/components/SegmentedControl';
import { FormPreviewDialog } from '@/features/forms/FormPreviewDialog';
import { FormThumbnail } from '@/features/forms/FormThumbnail';
import {
  buildFormPrefillContext,
  localIsoDate,
  prefillFormValues,
} from '@/features/forms/form-prefill';
import { findFormSchema } from '@/features/forms/form-registry';
import { validateForm } from '@/features/forms/form-validation';
import type { FormValues } from '@/features/forms/form-values';
import type { ClinicianProfile } from '@/state/clinician-profile';
import type { ClinicalEpisode, PatientProfile } from '@/state/patient-domain';
import {
  blankValues,
  FORM_107_ID,
  FORM_148_ID,
  type PrescribedLine,
  splitIntoBlanks,
} from './prescription-output';
import '@/styles/prescription.css';

export interface BlankInputs {
  readonly formId: string;
  readonly lines: readonly PrescribedLine[];
  readonly ageDays: number | null;
  readonly profile: PatientProfile | undefined;
  readonly episode: ClinicalEpisode | undefined;
  readonly clinician: ClinicianProfile;
}

/** The values of every blank the prescription needs, for the thumbnail and the preview. */
export function blanksOf(inputs: BlankInputs): {
  readonly schema: FormSchema | undefined;
  readonly values: readonly FormValues[];
} {
  const schema = findFormSchema(inputs.formId);
  if (!schema) return { schema, values: [] };
  const prefilled = prefillFormValues(
    schema,
    buildFormPrefillContext({
      profile: inputs.profile,
      episode: inputs.episode,
      clinician: inputs.clinician,
      now: new Date(),
    }),
  ).values;
  const groups = splitIntoBlanks(inputs.lines, inputs.formId);
  return {
    schema,
    values: groups.map((group) =>
      blankValues(schema, prefilled, group, { ageDays: inputs.ageDays }),
    ),
  };
}

/** The choice between the two blanks the prescription can be printed on. */
export function PrescriptionBlankChoice(props: {
  readonly formId: string;
  readonly onChange: (formId: string) => void;
}): JSX.Element {
  return (
    <SegmentedControl
      label="Бланк"
      value={props.formId}
      stretch
      options={[
        { value: FORM_107_ID, label: '107-1/у' },
        { value: FORM_148_ID, label: '148-1/у-88' },
      ]}
      onChange={props.onChange}
    />
  );
}

/** The small paper in the header: the real print rendering of the blank, opening the preview. */
export function PrescriptionBlankThumbnail(
  props: BlankInputs & { readonly page: number },
): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const blanks = createMemo(() => blanksOf(props));
  const current = (): FormValues | undefined =>
    blanks().values[Math.min(props.page, blanks().values.length - 1)];
  const validation = createMemo(() => {
    const schema = blanks().schema;
    const values = current();
    return schema && values
      ? validateForm(schema, values, { today: localIsoDate(new Date()) })
      : null;
  });
  return (
    <Show when={blanks().schema && current()}>
      <>
        <FormThumbnail
          schema={blanks().schema as FormSchema}
          values={current() as FormValues}
          onOpen={() => setOpen(true)}
        />
        <FormPreviewDialog
          open={open()}
          schema={blanks().schema as FormSchema}
          values={current() as FormValues}
          missingCount={validation()?.missing.length ?? 0}
          invalidCount={Object.keys(validation()?.invalid ?? {}).length}
          onClose={() => setOpen(false)}
        />
      </>
    </Show>
  );
}
