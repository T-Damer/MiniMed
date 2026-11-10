import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { PAGE_HEROES } from '@/app/page-heroes';

import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import type { HeaderAction } from '@/components/HeaderActions';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { isDiaryBirthDate, isDiaryPhone } from '@/features/diary/connected/diary-replica';
import type { DoctorDiaries } from '@/features/diary/connected/doctor-workspace';
import { operatorFromProfile } from '@/features/diary/consent/joining-documents';
import {
  discardNewPatientDraft,
  loadNewPatientDrafts,
  type NewPatientFields,
  newPatientDraft,
  newPatientDraftId,
  saveNewPatientDraft,
} from '@/features/diary/dashboard/new-patient-drafts';
import { writePastMeds } from '@/features/diary/dashboard/new-patient-history';
import { PairingView } from '@/features/diary/dashboard/PairingView';
import { PatientFormColumns } from '@/features/diary/dashboard/PatientFormColumns';
import { PatientIdentity } from '@/features/diary/dashboard/PatientIdentity';
import { type CareDraft, careInvitation, emptyCareDraft } from '@/features/diary/diary-care-draft';
import type { PastMedication } from '@/features/diary/diary-med-history';
import { FormStep, focusPatientStep } from '@/features/diary/FormStep';
import { MedHistoryContext } from '@/features/diary/med-history/plan-removals';
import { PatientScreenEditor } from '@/features/diary/PatientScreenEditor';
import { PatientView } from '@/features/diary/PatientView';
import { getClinicianProfile } from '@/state/clinician-profile';

/** The address segment of the «Новый пациент» screen (patient ids are 20 random characters). */
export const NEW_PATIENT_ROUTE = 'new';

/**
 * «Новый пациент», a screen of its own: a pseudonym, an emoji and optionally the phone (no real
 * name is needed on the server), the patient's screen built in place, then the one-time code for
 * their phone. What is typed is a draft from the first change (`new-patient-drafts.ts`): the
 * address takes the draft's id, so a reload or the draft card in the list opens it again.
 */
export function NewPatientScreen(props: {
  readonly workspace: DoctorDiaries;
  /** The draft to continue; none for an empty form. */
  readonly draftId: string | undefined;
  /** The form became a draft: its id goes into the address in place of the empty form's. */
  readonly onDraft: (id: string) => void;
  readonly onBack: () => void;
  readonly onCreated: (id: string) => void;
}): JSX.Element {
  const session = props.workspace.session;
  const [label, setLabel] = createSignal('');
  const [emoji, setEmoji] = createSignal('🦊');
  const [phone, setPhone] = createSignal('');
  const [birthDate, setBirthDate] = createSignal('');
  const [draft, setDraft] = createSignal<CareDraft>(emptyCareDraft());
  const [doctor, setDoctor] = createSignal(session.doctor.name);
  const [note, setNote] = createSignal('');
  /** «Прошлое лечение», kept in the draft until the patient exists. */
  const [pastMeds, setPastMeds] = createSignal<readonly PastMedication[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [created, setCreated] = createSignal<string>();
  /** The patient exists but the past treatment is not all written: «Записать» retries only that. */
  const [made, setMade] = createSignal<string>();
  const written = new Set<string>();
  const [discarding, setDiscarding] = createSignal(false);
  /** The draft this form writes to; undefined until the first change of an empty form. */
  const [draftId, setDraftId] = createSignal<string>();
  /** The kept drafts are read (a reload straight onto a draft's address waits for them). */
  const [ready, setReady] = createSignal(false);

  const fields = (): NewPatientFields => ({
    label: label(),
    emoji: emoji(),
    phone: phone(),
    birthDate: birthDate(),
    screen: draft(),
    doctor: doctor(),
    note: note(),
    pastMeds: pastMeds(),
  });
  /** What the form held when it was opened: no change, no draft. */
  let opened = '';

  const fill = (id: string | undefined): void => {
    const kept = newPatientDraft(id);
    // In the order `fields` reads them: the comparison is of the JSON text.
    const next: NewPatientFields = {
      label: kept?.label ?? '',
      emoji: kept?.emoji ?? '🦊',
      phone: kept?.phone ?? '',
      birthDate: kept?.birthDate ?? '',
      screen: kept?.screen ?? emptyCareDraft(),
      doctor: kept?.doctor ?? session.doctor.name,
      note: kept?.note ?? '',
      pastMeds: kept?.pastMeds ?? [],
    };
    // Set together, so the keeping effect sees the whole draft once and finds it unchanged.
    opened = JSON.stringify(next);
    batch(() => {
      setLabel(next.label);
      setEmoji(next.emoji);
      setPhone(next.phone);
      setBirthDate(next.birthDate);
      setDraft(next.screen);
      setDoctor(next.doctor);
      setNote(next.note);
      setPastMeds(next.pastMeds ?? []);
      setError('');
      setDraftId(kept?.id);
    });
  };

  onMount(() => {
    void loadNewPatientDrafts(session).then(() => {
      fill(untrack(() => props.draftId));
      setReady(true);
    });
  });
  // The address names another draft (the list's card, history): that draft fills the form.
  createEffect(
    on(
      () => props.draftId,
      (id) => {
        if (ready() && id !== untrack(draftId)) fill(id);
      },
      { defer: true },
    ),
  );
  // Every change is kept; the first one turns the empty form into a draft.
  createEffect(
    on(fields, (current) => {
      if (!untrack(ready) || untrack(created) || JSON.stringify(current) === opened) return;
      let id = untrack(draftId);
      if (!id) {
        id = newPatientDraftId();
        setDraftId(id);
        props.onDraft(id);
      }
      saveNewPatientDraft(session, id, current);
    }),
  );

  const headerActions = createMemo((): readonly HeaderAction[] | undefined =>
    draftId() && !created()
      ? [
          {
            id: 'discard',
            label: 'Удалить черновик',
            icon: 'trash',
            priority: 2,
            danger: true,
            disabled: busy(),
            testId: 'diary-new-discard',
            onSelect: () => setDiscarding(true),
          },
        ]
      : undefined,
  );

  const discard = (): void => {
    const id = draftId();
    setDiscarding(false);
    if (id) discardNewPatientDraft(session, id);
    props.onBack();
  };

  const savePastMeds = async (patientId: string): Promise<boolean> => {
    const result = await writePastMeds(
      (id, item) => props.workspace.savePastMed(id, item),
      patientId,
      pastMeds(),
      written,
    );
    if (result.kind === 'written') return true;
    setError(
      `Пациент добавлен, но прошлое лечение записано не полностью: ${result.reason}. Нажмите «Записать прошлое лечение» — повторим только его. Введённое сохранено в черновике.`,
    );
    return false;
  };

  const create = async (): Promise<void> => {
    setError('');
    const existing = made();
    if (!existing) {
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
    }
    setBusy(true);
    try {
      const id =
        existing ??
        (await props.workspace.createPatient(
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
        ));
      setMade(id);
      // The records of the past treatment need the patient's id: they follow the creation.
      if (!(await savePastMeds(id))) return;
      setCreated(id);
      const kept = draftId();
      if (kept) discardNewPatientDraft(session, kept);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось создать пациента.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="diary-new">
      <Page
        hero={PAGE_HEROES.diaryInner}
        navigation={
          <NavBack class="knowledge-back-button" aria-label="К списку" onClick={props.onBack} />
        }
        title={<Heading depth={1}>{created() ? 'Подключите телефон' : 'Новый пациент'}</Heading>}
        headerActions={headerActions()}
      />
      <ConfirmationDialog
        open={discarding()}
        title="Удалить черновик?"
        description={<p>Введённое для этого пациента пропадёт.</p>}
        confirmLabel="Удалить"
        danger
        onConfirm={discard}
        onOpenChange={setDiscarding}
      />
      <Show
        when={created()}
        fallback={
          <Show when={ready()}>
            <MedHistoryContext.Provider value={pastMeds}>
              <PatientFormColumns
                steps={
                  <>
                    <FormStep
                      step="profile"
                      number={1}
                      title="Профиль"
                      hint="Как пациент называется в вашем списке. Настоящее имя не нужно."
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
                        onSave: (item) => {
                          setPastMeds((list) => [
                            ...list.filter((one) => one.id !== item.id),
                            item,
                          ]);
                        },
                        onDelete: (id) => {
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
                      onClick={() => void create()}
                    >
                      {busy()
                        ? 'Шифруем и сохраняем…'
                        : made()
                          ? 'Записать прошлое лечение'
                          : 'Добавить пациента'}
                    </Button>
                  </>
                }
              />
            </MedHistoryContext.Provider>
          </Show>
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
