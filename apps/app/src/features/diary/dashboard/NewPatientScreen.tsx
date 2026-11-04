import { createSignal, type JSX, Show } from 'solid-js';
import { PAGE_HEROES } from '@/app/page-heroes';

import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { isDiaryBirthDate, isDiaryPhone } from '@/features/diary/connected/diary-replica';
import type { DoctorDiaries } from '@/features/diary/connected/doctor-workspace';
import { operatorFromProfile } from '@/features/diary/consent/joining-documents';
import { PairingView } from '@/features/diary/dashboard/PairingView';
import { PatientFormColumns } from '@/features/diary/dashboard/PatientFormColumns';
import { PatientIdentity } from '@/features/diary/dashboard/PatientIdentity';
import { type CareDraft, careInvitation, emptyCareDraft } from '@/features/diary/diary-care-draft';
import { PatientScreenEditor } from '@/features/diary/PatientScreenEditor';
import { getClinicianProfile } from '@/state/clinician-profile';

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
  const [birthDate, setBirthDate] = createSignal('');
  const [draft, setDraft] = createSignal<CareDraft>(emptyCareDraft());
  const [doctor, setDoctor] = createSignal(props.workspace.session.doctor.name);
  const [note, setNote] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [created, setCreated] = createSignal<string>();

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
    if (birthDate() && !isDiaryBirthDate(birthDate())) {
      setError('Проверьте дату рождения.');
      return;
    }
    setBusy(true);
    try {
      const id = await props.workspace.createPatient(
        {
          label: label().trim(),
          emoji: emoji(),
          ...(phone().trim() ? { phone: phone().trim() } : {}),
          ...(birthDate() ? { birthDate: birthDate() } : {}),
        },
        (patientId) =>
          careInvitation({
            id: patientId,
            draft: draft(),
            doctor: doctor(),
            note: note(),
            operator: operatorFromProfile(getClinicianProfile()),
          }),
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
        hero={PAGE_HEROES.patients}
        navigation={
          <NavBack class="knowledge-back-button" aria-label="К списку" onClick={props.onBack} />
        }
        title={<Heading depth={1}>{created() ? 'Подключите телефон' : 'Новый пациент'}</Heading>}
      />
      <Show
        when={created()}
        fallback={
          <PatientFormColumns
            onSubmit={(event) => void create(event)}
            identity={
              <PatientIdentity
                label={label()}
                emoji={emoji()}
                phone={phone()}
                birthDate={birthDate()}
                onLabel={setLabel}
                onEmoji={setEmoji}
                onPhone={setPhone}
                onBirthDate={setBirthDate}
              />
            }
            screen={
              <PatientScreenEditor
                draft={draft()}
                onChange={setDraft}
                doctor={doctor()}
                onDoctor={setDoctor}
                note={note()}
                onNote={setNote}
              />
            }
            footer={
              <>
                <Show when={error()}>
                  <p class="diary-dash__error diary-new__error" role="alert">
                    {error()}
                  </p>
                </Show>
                <Button class="diary-new__submit" type="submit" variant="primary" disabled={busy()}>
                  {busy() ? 'Шифруем и сохраняем…' : 'Добавить пациента'}
                </Button>
              </>
            }
          />
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
