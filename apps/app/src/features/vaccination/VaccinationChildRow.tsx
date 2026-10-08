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

import { Button } from '@/components/Button';
import { PatientPickerRow } from '@/components/PatientPickerRow';
import { TextField } from '@/components/TextField';
import {
  type ChildInput,
  childBirthDate,
  needsBirthDateInCard,
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
 * The child for the calendar: the shared compact patient row. The child is a patient card or just
 * a birth date typed in the chooser sheet (nothing is saved then). A card without a birth date
 * gets a date field under the row; the date is written into the card. The vault is unlocked on
 * demand by the chooser, exactly as in the calculators.
 */
export function VaccinationChildRow(props: {
  readonly today: string;
  readonly onChange: (input: ChildInput) => void;
}): JSX.Element {
  const [snapshot, setSnapshot] = createSignal<PatientVaultSnapshot>();
  const [patientId, setPatientId] = createSignal('');
  const [typedBirthDate, setTypedBirthDate] = createSignal('');
  const [problem, setProblem] = createSignal('');

  let refreshRequest = 0;
  const refresh = (): void => {
    const request = ++refreshRequest;
    if (!isPatientVaultUnlocked()) {
      setSnapshot(undefined);
      setPatientId('');
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

  /** Only a birth date stands in for the patient: the row names it instead of a card. */
  const standIn = (): { readonly title: string; readonly subtitle: string } | undefined => {
    const date = birthDate();
    if (profile() || date === null) return undefined;
    return {
      title: 'Без карточки',
      subtitle: `${displayIsoDate(date)} · ${childAgeLabel(date, props.today)}`,
    };
  };

  return (
    <section class="vax-child" aria-label="Ребёнок">
      <PatientPickerRow
        profiles={snapshot()?.profiles ?? []}
        patientId={patientId()}
        unlocked={snapshot() !== undefined && isPatientVaultUnlocked()}
        hint="Для отметок о прививках"
        standIn={standIn()}
        onPatientChange={(id) => {
          setPatientId(id);
          setProblem('');
        }}
        onSnapshotChange={(next) => {
          refreshRequest += 1;
          setSnapshot(next);
        }}
        chooserExtra={(close) => (
          <Show when={!profile()}>
            <div class="vax-child__form">
              <TextField
                class="vax-child__date"
                label="Или только дата рождения"
                type="date"
                value={typedBirthDate()}
                max={props.today}
                onInput={(event) => commitBirthDate(event.currentTarget.value)}
              />
              <div class="vax-child__actions">
                <Show when={typedBirthDate() !== ''}>
                  <Button
                    type="button"
                    variant="quiet"
                    class="vax-child__clear"
                    onClick={() => {
                      setTypedBirthDate('');
                      setProblem('');
                      close();
                    }}
                  >
                    Убрать
                  </Button>
                </Show>
                <Button type="button" variant="primary" class="vax-child__done" onClick={close}>
                  Готово
                </Button>
              </div>
            </div>
          </Show>
        )}
      />
      <Show when={profile() && !profile()?.birthDate}>
        <TextField
          class="vax-child__date"
          label="Дата рождения (запишется в карточку)"
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
    </section>
  );
}
