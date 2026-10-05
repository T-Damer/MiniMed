import { createEffect, createMemo, createSignal, For, type JSX, on, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { Button } from '@/components/Button';
import { Disclosure } from '@/components/Disclosure';
import { NativeDateTimeField } from '@/components/NativeDateTimeField';
import { TextField } from '@/components/TextField';
import {
  type DiagnosisDraftErrors,
  diagnosisFromDraft,
  diagnosisToDraft,
  draftsEqual,
  draftToPatch,
  type PatientFormDraft,
  type PatientFormDraftErrors,
  profileToDraft,
} from '@/features/notes/patient-form-data';
import {
  type ClinicalEpisode,
  PATIENT_ADDRESS_FIELDS,
  type PatientAddress,
  type PatientProfile,
  type PatientVaultSnapshot,
  setEpisodeDiagnosis,
  updatePatientProfileData,
} from '@/state/patient-domain';
import { updatePatientVault } from '@/state/patient-vault';
import '@/styles/patient-form-data.css';

type AddressKind = 'address' | 'stayAddress';

function AddressFields(props: {
  readonly draft: Readonly<Record<keyof PatientAddress, string>>;
  readonly idPrefix: string;
  readonly onChange: (key: keyof PatientAddress, value: string) => void;
}): JSX.Element {
  return (
    <div class="patient-form-data__grid">
      <For each={PATIENT_ADDRESS_FIELDS}>
        {(field) => (
          <TextField
            class="patient-form-data__field"
            id={`${props.idPrefix}-${field.key}`}
            label={field.label}
            autocomplete="off"
            inputMode={field.key === 'phone' ? 'tel' : undefined}
            value={props.draft[field.key]}
            onInput={(event) => props.onChange(field.key, event.currentTarget.value)}
          />
        )}
      </For>
    </div>
  );
}

/** Collapsible editor of the administrative data that official forms are filled from. */
export function PatientFormData(props: {
  readonly profile: PatientProfile;
  readonly onSnapshot: (snapshot: PatientVaultSnapshot) => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal<PatientFormDraft>(profileToDraft(props.profile));
  const [errors, setErrors] = createSignal<PatientFormDraftErrors>({});
  const [busy, setBusy] = createSignal(false);
  const dirty = createMemo(() => !draftsEqual(draft(), profileToDraft(props.profile)));
  const idPrefix = `patient-form-${props.profile.id}`;
  createEffect(
    on(
      () => props.profile.id,
      () => {
        setDraft(profileToDraft(props.profile));
        setErrors({});
      },
      { defer: true },
    ),
  );

  const setField = (
    key:
      | 'fullName'
      | 'snils'
      | 'omsNumber'
      | 'omsIssuedAt'
      | 'omsInsurer'
      | 'workplace'
      | 'citizenship',
    value: string,
  ): void => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (key === 'snils' || key === 'omsNumber') {
      setErrors(({ [key]: _cleared, ...rest }) => rest);
    }
  };
  const setAddress = (kind: AddressKind, key: keyof PatientAddress, value: string): void => {
    setDraft((current) => ({ ...current, [kind]: { ...current[kind], [key]: value } }));
  };

  const save = async (): Promise<void> => {
    if (busy()) return;
    const result = draftToPatch(draft());
    if (!result.patch) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const patch = result.patch;
      const snapshot = await updatePatientVault((current) =>
        updatePatientProfileData(current, props.profile.id, patch),
      );
      const saved = snapshot.profiles.find((profile) => profile.id === props.profile.id);
      if (saved) setDraft(profileToDraft(saved));
      props.onSnapshot(snapshot);
      toast('Данные для форм сохранены.');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Не удалось сохранить данные для форм.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Disclosure
      class="patient-form-data paper-card"
      title="Данные для справок и форм"
      description="ФИО, СНИЛС, полис ОМС, адрес, место работы, гражданство"
    >
      <div class="patient-form-data__body">
        <p class="patient-form-data__note">
          Подставляются в официальные формы. Хранятся только в хранилище пациентов на этом
          устройстве и не попадают в поиск.
        </p>
        <div class="patient-form-data__grid">
          <TextField
            class="patient-form-data__field patient-form-data__field--wide"
            label="ФИО полностью"
            autocomplete="off"
            value={draft().fullName}
            onInput={(event) => setField('fullName', event.currentTarget.value)}
          />
          <TextField
            class="patient-form-data__field"
            label="СНИЛС"
            autocomplete="off"
            inputMode="numeric"
            placeholder="123-456-789 01"
            value={draft().snils}
            error={errors().snils}
            onInput={(event) => setField('snils', event.currentTarget.value)}
          />
          <TextField
            class="patient-form-data__field patient-form-data__field--wide"
            label="Место работы / учёбы"
            autocomplete="off"
            value={draft().workplace}
            onInput={(event) => setField('workplace', event.currentTarget.value)}
          />
          <TextField
            class="patient-form-data__field"
            label="Гражданство"
            autocomplete="off"
            value={draft().citizenship}
            onInput={(event) => setField('citizenship', event.currentTarget.value)}
          />
        </div>

        <h3 class="patient-form-data__group-title">Полис ОМС</h3>
        <div class="patient-form-data__grid">
          <TextField
            class="patient-form-data__field"
            label="Номер полиса"
            autocomplete="off"
            inputMode="numeric"
            value={draft().omsNumber}
            error={errors().omsNumber}
            onInput={(event) => setField('omsNumber', event.currentTarget.value)}
          />
          <div class="patient-form-data__field">
            <span class="patient-form-data__label">Дата выдачи</span>
            <NativeDateTimeField
              type="date"
              label="Дата выдачи полиса ОМС"
              placeholder="Не указана"
              value={draft().omsIssuedAt}
              onChange={(value) => setField('omsIssuedAt', value)}
            />
          </div>
          <TextField
            class="patient-form-data__field patient-form-data__field--wide"
            label="Страховая медицинская организация"
            autocomplete="off"
            value={draft().omsInsurer}
            onInput={(event) => setField('omsInsurer', event.currentTarget.value)}
          />
        </div>

        <h3 class="patient-form-data__group-title">Адрес регистрации по месту жительства</h3>
        <AddressFields
          draft={draft().address}
          idPrefix={`${idPrefix}-address`}
          onChange={(key, value) => setAddress('address', key, value)}
        />

        <Disclosure variant="inline" title="Регистрация по месту пребывания">
          <AddressFields
            draft={draft().stayAddress}
            idPrefix={`${idPrefix}-stay`}
            onChange={(key, value) => setAddress('stayAddress', key, value)}
          />
        </Disclosure>

        <div class="patient-form-data__actions">
          <Button
            type="button"
            variant="primary"
            disabled={busy() || !dirty()}
            onClick={() => void save()}
          >
            {busy() ? 'Сохраняем…' : 'Сохранить данные'}
          </Button>
        </div>
      </div>
    </Disclosure>
  );
}

/** Diagnosis (wording and ICD-10 code) of one episode; prefills official forms. */
export function EpisodeDiagnosisEditor(props: {
  readonly episode: ClinicalEpisode;
  readonly onSnapshot: (snapshot: PatientVaultSnapshot) => void;
}): JSX.Element {
  const initial = diagnosisToDraft(props.episode.diagnosis);
  const [text, setText] = createSignal(initial.text);
  const [icd10, setIcd10] = createSignal(initial.icd10);
  const [errors, setErrors] = createSignal<DiagnosisDraftErrors>({});
  const [busy, setBusy] = createSignal(false);
  createEffect(
    on(
      () => props.episode.id,
      () => {
        const stored = diagnosisToDraft(props.episode.diagnosis);
        setText(stored.text);
        setIcd10(stored.icd10);
        setErrors({});
      },
      { defer: true },
    ),
  );
  const dirty = createMemo(() => {
    const stored = diagnosisToDraft(props.episode.diagnosis);
    return text() !== stored.text || icd10() !== stored.icd10;
  });

  const save = async (): Promise<void> => {
    if (busy()) return;
    const result = diagnosisFromDraft(text(), icd10());
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const diagnosis = result.diagnosis;
      const episodeId = props.episode.id;
      const snapshot = await updatePatientVault((current) =>
        setEpisodeDiagnosis(current, episodeId, diagnosis),
      );
      const saved = diagnosisToDraft(
        snapshot.episodes.find((candidate) => candidate.id === episodeId)?.diagnosis,
      );
      setText(saved.text);
      setIcd10(saved.icd10);
      props.onSnapshot(snapshot);
      toast('Диагноз осмотра сохранён.');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Не удалось сохранить диагноз.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="episode-diagnosis">
      <TextField
        class="episode-diagnosis__text"
        label="Диагноз осмотра"
        autocomplete="off"
        value={text()}
        error={errors().text}
        onInput={(event) => {
          setText(event.currentTarget.value);
          setErrors(({ text: _cleared, ...rest }) => rest);
        }}
      />
      <TextField
        class="episode-diagnosis__code"
        label="Код МКБ-10"
        autocomplete="off"
        placeholder="J45.0"
        value={icd10()}
        error={errors().icd10}
        onInput={(event) => {
          setIcd10(event.currentTarget.value.toUpperCase());
          setErrors(({ icd10: _cleared, ...rest }) => rest);
        }}
      />
      <Show when={dirty()}>
        <Button
          type="button"
          variant="secondary"
          class="episode-diagnosis__save"
          disabled={busy()}
          onClick={() => void save()}
        >
          {busy() ? 'Сохраняем…' : 'Сохранить диагноз'}
        </Button>
      </Show>
    </div>
  );
}
