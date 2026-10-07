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
import { PatientCaseCombobox } from '@/components/PatientCaseCombobox';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Switch } from '@/components/Switch';
import { TextField } from '@/components/TextField';
import {
  attachmentIsStale,
  attachPlan,
  loadAttachment,
  saveAttachment,
  type VaccinationAttachment,
} from '@/features/vaccination/vaccination-attachment';
import type { VaccinationCalendar } from '@/features/vaccination/vaccination-calendar';
import {
  type ChildInput,
  type ChildMode,
  childBirthDate,
  needsBirthDateInCard,
} from '@/features/vaccination/vaccination-child';
import { displayIsoDate } from '@/features/vaccination/vaccination-print';
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

const MODE_OPTIONS = [
  { value: 'patient', label: 'Пациент' },
  { value: 'quick', label: 'Только расчёт' },
] as const satisfies readonly { value: ChildMode; label: string }[];

function attachmentLine(attachment: VaccinationAttachment, stale: boolean): string {
  const day = displayIsoDate(attachment.attachedAt.slice(0, 10));
  return stale
    ? `План прикреплён ${day} по другой редакции приказа (${attachment.editionLine}); обновите запись.`
    : `План прикреплён к карточке ${day} (${attachment.editionLine}).`;
}

/**
 * Chooses the child the plan is for: a patient card (the plan is attached to it and the card's
 * birth date is used) or just a birth date with nothing saved. The vault is unlocked on demand by
 * the card field, exactly as in the calculators.
 */
export function VaccinationChildPanel(props: {
  readonly calendar: VaccinationCalendar;
  readonly today: string;
  readonly onChange: (input: ChildInput) => void;
}): JSX.Element {
  const [mode, setMode] = createSignal<ChildMode>('patient');
  const [snapshot, setSnapshot] = createSignal<PatientVaultSnapshot>();
  const [patientId, setPatientId] = createSignal('');
  const [subjectLabel, setSubjectLabel] = createSignal('');
  const [typedBirthDate, setTypedBirthDate] = createSignal('');
  const [typedName, setTypedName] = createSignal('');
  const [printName, setPrintName] = createSignal(true);
  const [attachment, setAttachment] = createSignal<VaccinationAttachment>();
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal('');
  const [problem, setProblem] = createSignal('');

  let refreshRequest = 0;
  const refresh = (): void => {
    const request = ++refreshRequest;
    if (!isPatientVaultUnlocked()) {
      setSnapshot(undefined);
      setPatientId('');
      setSubjectLabel('');
      setAttachment(undefined);
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
    mode: mode(),
    profile: profile(),
    typedBirthDate: typedBirthDate(),
    typedName: typedName(),
    printName: printName(),
  }));
  createEffect(() => props.onChange(input()));

  // The attachment of the chosen card is read from the vault; a damaged record is shown, not hidden.
  createEffect(
    on(patientId, (id) => {
      setAttachment(undefined);
      setMessage('');
      if (!id) return;
      void loadAttachment(id)
        .then((loaded) => {
          if (patientId() === id) setAttachment(loaded);
        })
        .catch((cause: unknown) => {
          if (patientId() === id) {
            setProblem(
              cause instanceof Error ? cause.message : 'Не удалось прочитать запись о плане.',
            );
          }
        });
    }),
  );

  const birthDate = (): string | null => childBirthDate(input());
  const canAttach = (): boolean => profile() !== undefined && birthDate() !== null && !busy();
  const attach = async (): Promise<void> => {
    const card = profile();
    const date = birthDate();
    if (!card || !date) return;
    setBusy(true);
    setProblem('');
    setMessage('');
    try {
      if (needsBirthDateInCard(input())) {
        await updatePatientVault((current) => setPatientBirthDate(current, card.id, date));
      }
      const next = attachPlan(props.calendar, new Date(), attachment());
      await saveAttachment(card.id, next);
      setAttachment(next);
      setMessage('План прикреплён к карточке пациента.');
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Не удалось прикрепить план.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="vax-child paper-card" aria-label="Для кого план">
      <SegmentedControl
        class="vax-child__mode"
        label="Для кого план"
        options={MODE_OPTIONS}
        value={mode()}
        onChange={setMode}
      />
      <Show
        when={mode() === 'patient'}
        fallback={
          <div class="vax-child__fields">
            <TextField
              class="vax-child__birth"
              label="Дата рождения ребёнка"
              type="date"
              value={typedBirthDate()}
              max={props.today}
              onInput={(event) => setTypedBirthDate(event.currentTarget.value)}
            />
            <TextField
              class="vax-child__name"
              label="Имя на листе (необязательно)"
              value={typedName()}
              autocomplete="off"
              onInput={(event) => setTypedName(event.currentTarget.value)}
            />
            <p class="vax-child__note">
              Расчёт без сохранения: дата рождения и имя нигде не записываются и остаются только на
              этой странице.
            </p>
          </div>
        }
      >
        <div class="vax-child__fields">
          <PatientCaseCombobox
            class="vax-child__patient"
            label="Ребёнок — карточка пациента"
            profiles={snapshot()?.profiles ?? []}
            patientId={patientId()}
            subjectLabel={subjectLabel()}
            unlocked={snapshot() !== undefined && isPatientVaultUnlocked()}
            onPatientChange={(id) => {
              setPatientId(id);
              setTypedBirthDate('');
              setProblem('');
            }}
            onSubjectLabelChange={setSubjectLabel}
            onSnapshotChange={(next) => {
              refreshRequest += 1;
              setSnapshot(next);
            }}
          />
          <Show
            when={profile()}
            fallback={
              <p class="vax-child__note">
                Выберите карточку или добавьте нового пациента: план прикрепляется к карточке, дата
                рождения берётся из неё.
              </p>
            }
          >
            {(card) => (
              <>
                <Show
                  when={card().birthDate}
                  fallback={
                    <TextField
                      class="vax-child__birth"
                      label="Дата рождения ребёнка"
                      type="date"
                      value={typedBirthDate()}
                      max={props.today}
                      hint="В карточке даты рождения нет; она запишется туда при прикреплении плана."
                      onInput={(event) => setTypedBirthDate(event.currentTarget.value)}
                    />
                  }
                >
                  {(date) => (
                    <p class="vax-child__fact">
                      <span class="vax-child__fact-label">Дата рождения</span>
                      <span class="vax-child__fact-value">{displayIsoDate(date())}</span>
                      <span class="vax-child__fact-source">из карточки</span>
                    </p>
                  )}
                </Show>
                <div class="vax-child__switch">
                  <Switch
                    aria-label="Печатать имя ребёнка на листе"
                    checked={printName()}
                    onChange={setPrintName}
                  />
                  <span class="vax-child__switch-label">Печатать имя на листе</span>
                </div>
                <div class="vax-child__attach">
                  <Show
                    when={attachment()}
                    fallback={
                      <p class="vax-child__note">
                        План ещё не прикреплён к карточке: прикреплённый план остаётся в защищённом
                        хранилище пациентов вместе с карточкой.
                      </p>
                    }
                  >
                    {(saved) => (
                      <p class="vax-child__note vax-child__note--saved">
                        {attachmentLine(saved(), attachmentIsStale(saved(), props.calendar))}
                      </p>
                    )}
                  </Show>
                  <Button
                    type="button"
                    variant={attachment() ? 'secondary' : 'primary'}
                    class="vax-child__attach-button"
                    disabled={!canAttach()}
                    onClick={() => void attach()}
                  >
                    {attachment() ? 'Обновить запись о плане' : 'Прикрепить план к карточке'}
                  </Button>
                </div>
              </>
            )}
          </Show>
        </div>
      </Show>
      <Show when={message()}>
        <p class="vax-child__status" role="status">
          {message()}
        </p>
      </Show>
      <Show when={problem()}>
        <p class="vax-child__problem" role="alert">
          {problem()}
        </p>
      </Show>
    </section>
  );
}
