import { createSignal, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { isDiaryPhone } from '@/features/diary/connected/diary-replica';
import type { DoctorDiaries } from '@/features/diary/connected/doctor-workspace';
import { frequentDrugs } from '@/features/diary/dashboard/frequent-drugs';
import { PairingView } from '@/features/diary/dashboard/PairingView';
import { PatientIdentity } from '@/features/diary/dashboard/PatientIdentity';
import { type CareDraft, careInvitation, emptyCareDraft } from '@/features/diary/diary-care-draft';
import { PatientScreenEditor } from '@/features/diary/PatientScreenEditor';

/** The address segment of the «Новый пациент» screen (patient ids are 20 random characters). */
export const NEW_PATIENT_ROUTE = 'new';

/**
 * «Новый пациент», a screen of its own: a pseudonym, an emoji and optionally the phone (no real
 * name is needed on the server), the patient's screen built in place, then the one-time code for
 * their phone.
 */
export function NewPatientScreen(props: {
  readonly workspace: DoctorDiaries;
  readonly onBack: () => void;
  readonly onCreated: (id: string) => void;
}): JSX.Element {
  const [label, setLabel] = createSignal('');
  const [emoji, setEmoji] = createSignal('🦊');
  const [phone, setPhone] = createSignal('');
  const [draft, setDraft] = createSignal<CareDraft>(emptyCareDraft());
  const [doctor, setDoctor] = createSignal(props.workspace.session.doctor.name);
  const [note, setNote] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [created, setCreated] = createSignal<string>();
  const frequent = frequentDrugs(
    props.workspace.patients().map((patient) => patient.replica.invitation),
  );

  const create = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    if (!label().trim()) {
      setError('Как называть пациента в списке? Подойдёт псевдоним.');
      return;
    }
    if (phone().trim() && !isDiaryPhone(phone())) {
      setError('Проверьте телефон пациента.');
      return;
    }
    setBusy(true);
    try {
      const id = await props.workspace.createPatient(
        {
          label: label().trim(),
          emoji: emoji(),
          ...(phone().trim() ? { phone: phone().trim() } : {}),
        },
        (patientId) =>
          careInvitation({ id: patientId, draft: draft(), doctor: doctor(), note: note() }),
      );
      setCreated(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось создать пациента.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="diary-new">
      <Page
        navigation={
          <NavBack class="knowledge-back-button" aria-label="К списку" onClick={props.onBack} />
        }
        title={<Heading depth={1}>{created() ? 'Подключите телефон' : 'Новый пациент'}</Heading>}
      />
      <Show
        when={created()}
        fallback={
          <form class="diary-dash-form diary-new__form" onSubmit={(event) => void create(event)}>
            <PatientIdentity
              label={label()}
              emoji={emoji()}
              phone={phone()}
              onLabel={setLabel}
              onEmoji={setEmoji}
              onPhone={setPhone}
            />
            <PatientScreenEditor
              draft={draft()}
              onChange={setDraft}
              doctor={doctor()}
              onDoctor={setDoctor}
              note={note()}
              onNote={setNote}
              frequent={frequent}
            />
            <Show when={error()}>
              <p class="diary-dash__error" role="alert">
                {error()}
              </p>
            </Show>
            <Button type="submit" variant="primary" disabled={busy()}>
              {busy() ? 'Шифруем и сохраняем…' : 'Создать и показать код'}
            </Button>
          </form>
        }
      >
        {(id) => (
          <PairingView
            workspace={props.workspace}
            patientId={id()}
            onDone={() => props.onCreated(id())}
          />
        )}
      </Show>
    </div>
  );
}
