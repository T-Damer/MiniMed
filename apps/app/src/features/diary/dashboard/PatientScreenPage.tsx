import { createSignal, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { isDiaryBirthDate, isDiaryPhone } from '@/features/diary/connected/diary-replica';
import type { DoctorDiaries, DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { frequentDrugs } from '@/features/diary/dashboard/frequent-drugs';
import { PatientIdentity } from '@/features/diary/dashboard/PatientIdentity';
import { type CareDraft, careDraftFrom, careInvitation } from '@/features/diary/diary-care-draft';
import type { DiaryInvitation } from '@/features/diary/diary-model';
import { PatientScreenEditor } from '@/features/diary/PatientScreenEditor';

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * «Экран пациента»: the patient's day screen as the doctor edits it (sections, contacts, note) and
 * the doctor's own label, emoji and phone for the patient.
 */
export function PatientScreenPage(props: {
  readonly workspace: DoctorDiaries;
  readonly patient: DoctorPatient;
  readonly invitation: DiaryInvitation;
  readonly onClose: () => void;
}): JSX.Element {
  const profile = props.patient.replica.profile;
  const [draft, setDraft] = createSignal<CareDraft>(careDraftFrom(props.invitation));
  const [doctor, setDoctor] = createSignal(props.invitation.doctor ?? '');
  const [note, setNote] = createSignal(props.invitation.note ?? '');
  const [label, setLabel] = createSignal(profile?.label ?? '');
  const [emoji, setEmoji] = createSignal(profile?.emoji ?? '🙂');
  const [phone, setPhone] = createSignal(profile?.phone ?? '');
  const [birthDate, setBirthDate] = createSignal(profile?.birthDate ?? '');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const frequent = frequentDrugs(
    props.workspace.patients().map((patient) => patient.replica.invitation),
  );

  const save = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    setError('');
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
      const invitation = careInvitation({
        id: props.invitation.id,
        draft: draft(),
        doctor: doctor(),
        note: note(),
        previous: props.invitation,
      });
      await props.workspace.writePlan(props.patient.summary.id, invitation);
      const next = {
        label: label().trim() || profile?.label || 'Пациент',
        emoji: emoji(),
        ...(phone().trim() ? { phone: phone().trim() } : {}),
        ...(birthDate() ? { birthDate: birthDate() } : {}),
        // Not edited here, kept as it was (an archived patient stays archived).
        ...(profile?.archived ? { archived: true } : {}),
      };
      if (
        next.label !== profile?.label ||
        next.emoji !== profile?.emoji ||
        (next.phone ?? '') !== (profile?.phone ?? '') ||
        (next.birthDate ?? '') !== (profile?.birthDate ?? '')
      ) {
        await props.workspace.writeProfile(props.patient.summary.id, next);
      }
      props.onClose();
    } catch (cause) {
      setError(errorText(cause, 'Не удалось сохранить.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="diary-new">
      <Page
        navigation={
          <NavBack class="knowledge-back-button" aria-label="К пациенту" onClick={props.onClose} />
        }
        title={<Heading depth={1}>Экран пациента</Heading>}
        description="Изменения придут пациенту сами"
      />
      <form class="diary-dash-form diary-new__form" onSubmit={(event) => void save(event)}>
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
          {busy() ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      </form>
    </div>
  );
}
