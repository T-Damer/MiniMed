import { createSignal, type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';
import { PAGE_HEROES } from '@/app/page-heroes';

import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { isDiaryBirthDate, isDiaryPhone } from '@/features/diary/connected/diary-replica';
import type { DoctorDiaries, DoctorPatient } from '@/features/diary/connected/doctor-workspace';
import { operatorFromProfile } from '@/features/diary/consent/joining-documents';
import { TipsDialog } from '@/features/diary/dashboard/PatientDialogs';
import { PatientFormColumns } from '@/features/diary/dashboard/PatientFormColumns';
import { PatientIdentity } from '@/features/diary/dashboard/PatientIdentity';
import { type CareDraft, careDraftFrom, careInvitation } from '@/features/diary/diary-care-draft';
import type { PastMedication } from '@/features/diary/diary-med-history';
import type { DiaryInvitation } from '@/features/diary/diary-model';
import { FormStep, focusPatientStep } from '@/features/diary/FormStep';
import { MedHistoryContext } from '@/features/diary/med-history/plan-removals';
import { PatientScreenEditor } from '@/features/diary/PatientScreenEditor';
import { PatientView } from '@/features/diary/PatientView';
import { getClinicianProfile } from '@/state/clinician-profile';

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * «Редактировать» (the patient page's one edit entry, DIARY20): the patient's day screen as the
 * doctor edits it (sections, contacts, note), the tips, and the doctor's own label, emoji and phone
 * for the patient.
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
  const [tips, setTips] = createSignal(false);
  /** The history as the doctor edits it here: each change is written at once, like on the patient page. */
  const [pastMeds, setPastMeds] = createSignal<readonly PastMedication[]>(
    Object.values(props.patient.replica.medHistory ?? {}),
  );

  const save = async (): Promise<void> => {
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
        operator: operatorFromProfile(getClinicianProfile()),
      });
      // Merged onto a colleague's save made meanwhile (DIARY20); both changed → this one kept.
      const outcome = await props.workspace.writePlan(
        props.patient.summary.id,
        invitation,
        props.invitation,
      );
      if (outcome.invitation !== invitation) {
        toast(
          outcome.conflicts.length
            ? `Коллега тоже менял план — оставлены ваши правки: ${outcome.conflicts.join(', ')}`
            : 'Коллега тоже менял план — его правки сохранены вместе с вашими',
        );
      }
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
        hero={PAGE_HEROES.diaryInner}
        navigation={
          <NavBack class="knowledge-back-button" aria-label="К пациенту" onClick={props.onClose} />
        }
        title={<Heading depth={1}>Редактировать</Heading>}
        description="Экран пациента: изменения придут ему сами"
        headerActions={[
          {
            id: 'tips',
            label: 'Подсказки пациенту',
            icon: 'lightbulb',
            priority: 1,
            onSelect: () => setTips(true),
          },
        ]}
      />
      <MedHistoryContext.Provider value={pastMeds}>
        <PatientFormColumns
          steps={
            <>
              <FormStep
                step="profile"
                number={1}
                title="Профиль"
                hint="Как пациент называется в вашем списке."
              >
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
              </FormStep>
              <PatientScreenEditor
                draft={draft()}
                onChange={setDraft}
                doctor={doctor()}
                onDoctor={setDoctor}
                note={note()}
                onNote={setNote}
                history={{
                  items: pastMeds(),
                  onSave: async (item) => {
                    await props.workspace.savePastMed(props.patient.summary.id, item);
                    setPastMeds((list) => [...list.filter((one) => one.id !== item.id), item]);
                  },
                  onDelete: async (id) => {
                    await props.workspace.deletePastMed(props.patient.summary.id, id);
                    setPastMeds((list) => list.filter((one) => one.id !== id));
                  },
                }}
              />
            </>
          }
          view={(afterStep) => (
            <PatientView
              draft={draft()}
              doctor={doctor()}
              note={note()}
              onStep={(step) => {
                afterStep?.();
                requestAnimationFrame(() => focusPatientStep(step));
              }}
            />
          )}
          footer={
            <>
              <Show when={error()}>
                <p class="diary-dash__error diary-new__error" role="alert">
                  {error()}
                </p>
              </Show>
              <Button
                class="diary-new__submit"
                type="button"
                variant="primary"
                disabled={busy()}
                onClick={() => void save()}
              >
                {busy() ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </>
          }
        />
      </MedHistoryContext.Provider>
      <Show when={tips()}>
        <TipsDialog
          workspace={props.workspace}
          patient={props.patient}
          invitation={props.patient.replica.invitation ?? props.invitation}
          onClose={() => setTips(false)}
        />
      </Show>
    </div>
  );
}
