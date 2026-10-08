import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { PatientAvatar } from '@/components/PatientAvatar';
import { PatientCaseCombobox } from '@/components/PatientCaseCombobox';
import { TextField } from '@/components/TextField';
import {
  type ChildInput,
  childBirthDate,
  needsBirthDateInCard,
  patientSheetName,
} from '@/features/vaccination/vaccination-child';
import { childAgeLabel, displayIsoDate } from '@/features/vaccination/vaccination-format';
import type { PatientProfile, PatientVaultSnapshot } from '@/state/patient-domain';
import { setPatientBirthDate } from '@/state/patient-domain';
import {
  acknowledgePatientVaultUiCleared,
  isPatientVaultUnlocked,
  PATIENT_VAULT_EVENT,
  PATIENT_VAULT_LOCK_EVENT,
  readPatientVault,
  updatePatientVault,
} from '@/state/patient-vault';

/**
 * «Compact patient row» (AGENTS.md): one row for the child. Empty it says what to choose; chosen it
 * shows the avatar, the full name, the birth date and a button to change. The child is a patient
 * card or just a birth date (nothing is saved then). The vault is unlocked on demand by the card
 * field, exactly as in the calculators.
 */
export function VaccinationChildRow(props: {
  readonly today: string;
  readonly onChange: (input: ChildInput) => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [snapshot, setSnapshot] = createSignal<PatientVaultSnapshot>();
  const [patientId, setPatientId] = createSignal('');
  const [subjectLabel, setSubjectLabel] = createSignal('');
  const [typedBirthDate, setTypedBirthDate] = createSignal('');
  const [problem, setProblem] = createSignal('');

  let refreshRequest = 0;
  const refresh = (): void => {
    const request = ++refreshRequest;
    if (!isPatientVaultUnlocked()) {
      setSnapshot(undefined);
      setPatientId('');
      setSubjectLabel('');
      acknowledgePatientVaultUiCleared();
      return;
    }
    void readPatientVault()
      .then((next) => {
        if (request === refreshRequest && isPatientVaultUnlocked()) setSnapshot(next);
      })
      .catch((cause: unknown) => {
        if (request !== refreshRequest) return;
        setSnapshot(undefined);
        setProblem(cause instanceof Error ? cause.message : 'Не удалось прочитать пациентов.');
      });
  };
  onMount(() => {
    refresh();
    window.addEventListener(PATIENT_VAULT_EVENT, refresh);
    window.addEventListener(PATIENT_VAULT_LOCK_EVENT, refresh);
  });
  onCleanup(() => {
    refreshRequest += 1;
    window.removeEventListener(PATIENT_VAULT_EVENT, refresh);
    window.removeEventListener(PATIENT_VAULT_LOCK_EVENT, refresh);
  });

  const profile = createMemo<PatientProfile | undefined>(() =>
    snapshot()?.profiles.find((candidate) => candidate.id === patientId()),
  );
  const input = createMemo<ChildInput>(() => ({
    profile: profile(),
    typedBirthDate: typedBirthDate(),
  }));
  createEffect(() => props.onChange(input()));
  // A date typed for one card must not leak onto the next.
  createEffect(on(patientId, () => setTypedBirthDate(''), { defer: true }));

  const birthDate = (): string | null => childBirthDate(input());
  const chosen = (): boolean => profile() !== undefined || birthDate() !== null;

  /** A birth date for a card that has none is written into the card (it is the card's data). */
  const commitBirthDate = (value: string): void => {
    setTypedBirthDate(value);
    const card = profile();
    if (
      !card ||
      !needsBirthDateInCard(input()) ||
      childBirthDate({ profile: undefined, typedBirthDate: value }) === null
    ) {
      return;
    }
    setProblem('');
    void updatePatientVault((current) => setPatientBirthDate(current, card.id, value)).catch(
      (cause: unknown) => {
        setProblem(cause instanceof Error ? cause.message : 'Не удалось записать дату рождения.');
      },
    );
  };

  const reset = (): void => {
    setPatientId('');
    setSubjectLabel('');
    setTypedBirthDate('');
    setProblem('');
  };

  return (
    <section class="vax-child" aria-label="Ребёнок">
      <div class="vax-child__row">
        <Show
          when={profile()}
          fallback={
            <span class="vax-child__avatar vax-child__avatar--glyph" aria-hidden="true">
              <AppGlyph name={birthDate() ? 'calendar' : 'users'} class="vax-child__avatar-icon" />
            </span>
          }
        >
          {(card) => <PatientAvatar name={card().displayName} avatar={card().avatar} />}
        </Show>
        <p class="vax-child__text">
          <Show
            when={chosen()}
            fallback={
              <>
                <span class="vax-child__name">Ребёнок</span>
                <span class="vax-child__birth">выберите, чтобы отмечать прививки</span>
              </>
            }
          >
            <span class="vax-child__name">
              {profile() ? patientSheetName(profile() as PatientProfile) : 'Без карточки'}
            </span>
            <span class="vax-child__birth">
              <Show when={birthDate()} fallback="дата рождения не указана">
                {(date) => (
                  <>
                    {displayIsoDate(date())}
                    {' · '}
                    {childAgeLabel(date(), props.today)}
                  </>
                )}
              </Show>
            </span>
          </Show>
        </p>
        <Button
          type="button"
          variant="icon"
          class="vax-child__change"
          aria-label={chosen() ? 'Сменить ребёнка' : 'Выбрать ребёнка'}
          title={chosen() ? 'Сменить ребёнка' : 'Выбрать ребёнка'}
          icon={<AppGlyph name={chosen() ? 'edit' : 'plus'} />}
          onClick={() => setOpen(true)}
        />
      </div>
      <OverlayDialog
        open={open()}
        title="Ребёнок"
        class="vax-sheet"
        bodyClass="vax-sheet__body"
        onClose={() => setOpen(false)}
      >
        <div class="vax-child__form">
          <PatientCaseCombobox
            class="vax-child__patient"
            label="Карточка пациента"
            profiles={snapshot()?.profiles ?? []}
            patientId={patientId()}
            subjectLabel={subjectLabel()}
            unlocked={snapshot() !== undefined && isPatientVaultUnlocked()}
            onPatientChange={(id) => {
              setPatientId(id);
              setProblem('');
              const card = snapshot()?.profiles.find((candidate) => candidate.id === id);
              if (card?.birthDate) setOpen(false);
            }}
            onSubjectLabelChange={setSubjectLabel}
            onSnapshotChange={(next) => {
              refreshRequest += 1;
              setSnapshot(next);
            }}
          />
          <Show when={!profile()?.birthDate}>
            <TextField
              class="vax-child__date"
              label={
                profile() ? 'Дата рождения (запишется в карточку)' : 'Или только дата рождения'
              }
              type="date"
              value={typedBirthDate()}
              max={props.today}
              onInput={(event) => commitBirthDate(event.currentTarget.value)}
            />
          </Show>
          <Show when={problem()}>
            <p class="vax-child__problem" role="alert">
              {problem()}
            </p>
          </Show>
          <div class="vax-child__actions">
            <Show when={chosen()}>
              <Button type="button" variant="quiet" class="vax-child__clear" onClick={reset}>
                Убрать
              </Button>
            </Show>
            <Button
              type="button"
              variant="primary"
              class="vax-child__done"
              disabled={!chosen()}
              onClick={() => setOpen(false)}
            >
              Готово
            </Button>
          </div>
        </div>
      </OverlayDialog>
    </section>
  );
}
