import { createEffect, createSignal, For, type JSX, on, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { Disclosure } from '@/components/Disclosure';
import { NativeDateTimeField } from '@/components/NativeDateTimeField';
import { TextField } from '@/components/TextField';
import {
  createDraftState,
  DRAFT_STATE_LABELS,
  type DraftState,
} from '@/features/notes/draft-status';
import {
  createDiagnosisSaver,
  createFormDataSaver,
  readDiagnosisDraft,
  readFormDraft,
} from '@/features/notes/patient-draft-savers';
import {
  type DiagnosisDraftErrors,
  diagnosisFromDraft,
  diagnosisToDraft,
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
} from '@/state/patient-domain';
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

function diagnosisErrors(text: string, icd10: string): DiagnosisDraftErrors {
  return diagnosisFromDraft(text, icd10).errors ?? {};
}

/** Quiet autosave status line; keeps its height so the fields below never jump. */
function DraftStatus(props: { readonly state: DraftState; readonly class?: string }): JSX.Element {
  return (
    <p
      class={`draft-status ${props.class ?? ''}`.trim()}
      classList={{
        'draft-status--visible': props.state !== 'idle',
        'draft-status--draft': props.state === 'draft',
      }}
      role="status"
      aria-live="polite"
    >
      {DRAFT_STATE_LABELS[props.state]}
    </p>
  );
}

/**
 * Collapsible editor of the administrative data that official forms are filled from. It is an
 * autosaved draft: valid fields reach the patient vault as they are typed; a field that is not
 * valid yet (SNILS, policy) keeps the typed text and shows its error, and nothing is lost on a
 * reload. There is nothing to approve here, so there is no «Сохранить».
 */
export function PatientFormData(props: {
  readonly profile: PatientProfile;
  readonly onSnapshot: (snapshot: PatientVaultSnapshot) => void;
}): JSX.Element {
  const [draft, setDraft] = createSignal<PatientFormDraft>(profileToDraft(props.profile));
  const [errors, setErrors] = createSignal<PatientFormDraftErrors>({});
  const status = createDraftState();
  const idPrefix = `patient-form-${props.profile.id}`;
  let edits = 0;
  const showErrors = (next: PatientFormDraftErrors): void => {
    setErrors(next);
    status.setIncomplete(Object.keys(next).length > 0);
  };
  const saver = createFormDataSaver({
    patientId: props.profile.id,
    onSnapshot: (snapshot) => props.onSnapshot(snapshot),
    onError: (cause) =>
      toast(cause instanceof Error ? cause.message : 'Не удалось сохранить данные для форм.'),
    onPendingChange: status.setPending,
    onValidation: showErrors,
  });
  // Text a reload cut off before the vault could take it comes back as the draft.
  onMount(() => {
    const seen = edits;
    void readFormDraft(props.profile.id)
      .then((copy) => {
        if (!copy || edits !== seen) return;
        setDraft(copy);
        showErrors(draftToPatch(copy).errors);
      })
      .catch((cause: unknown) =>
        toast(cause instanceof Error ? cause.message : 'Не удалось прочитать черновик.'),
      );
  });
  // Leaving the card saves what is typed; the write-ahead copy covers a closed page.
  onCleanup(() => {
    void saver.flush();
    saver.dispose();
  });

  const change = (next: PatientFormDraft): void => {
    edits += 1;
    setDraft(next);
    status.touch();
    saver.edit(next);
  };
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
    change({ ...draft(), [key]: value });
    if (key === 'snils' || key === 'omsNumber') {
      setErrors(({ [key]: _cleared, ...rest }) => rest);
    }
  };
  const setAddress = (kind: AddressKind, key: keyof PatientAddress, value: string): void => {
    change({ ...draft(), [kind]: { ...draft()[kind], [key]: value } });
  };

  return (
    <Disclosure
      class="patient-form-data paper-card"
      title="Данные для справок и форм"
      description="ФИО, СНИЛС, полис ОМС, адрес, место работы, гражданство"
      meta={
        <Show when={status.state() === 'draft'}>
          <span class="patient-form-data__draft-badge">Черновик</span>
        </Show>
      }
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

        <DraftStatus state={status.state()} />
      </div>
    </Disclosure>
  );
}

/**
 * Diagnosis (wording and ICD-10 code) of one visit; prefills official forms. An autosaved draft: a
 * well-formed diagnosis reaches the vault as it is typed; a code in the wrong format keeps the
 * typed text, shows its error and leaves the stored diagnosis as it was until it is fixed. The
 * visit's «Закрыть» is the sign-off, so there is no «Сохранить».
 */
export function EpisodeDiagnosisEditor(props: {
  readonly episode: ClinicalEpisode;
  readonly onSnapshot: (snapshot: PatientVaultSnapshot) => void;
}): JSX.Element {
  const initial = diagnosisToDraft(props.episode.diagnosis);
  const [text, setText] = createSignal(initial.text);
  const [icd10, setIcd10] = createSignal(initial.icd10);
  const [errors, setErrors] = createSignal<DiagnosisDraftErrors>({});
  const status = createDraftState();
  let edits = 0;
  const showErrors = (next: DiagnosisDraftErrors): void => {
    setErrors(next);
    status.setIncomplete(Object.keys(next).length > 0);
  };
  const saver = createDiagnosisSaver({
    patientId: props.episode.patientId,
    episodeId: () => props.episode.id,
    onSnapshot: (snapshot) => props.onSnapshot(snapshot),
    onError: (cause) =>
      toast(cause instanceof Error ? cause.message : 'Не удалось сохранить диагноз.'),
    onPendingChange: status.setPending,
    // The answer of a save for a visit that is no longer shown is not this editor's.
    onValidation: (next, episodeId) => {
      if (episodeId === props.episode.id) showErrors(next);
    },
  });
  /** Shows what a reload cut off before the vault could take it, unless the person typed first. */
  const seedFromDraft = (episodeId: string): void => {
    const seen = edits;
    void readDiagnosisDraft(props.episode.patientId, episodeId)
      .then((copy) => {
        if (!copy || edits !== seen || props.episode.id !== episodeId) return;
        setText(copy.text);
        setIcd10(copy.icd10);
        showErrors(diagnosisErrors(copy.text, copy.icd10));
      })
      .catch((cause: unknown) =>
        toast(cause instanceof Error ? cause.message : 'Не удалось прочитать черновик.'),
      );
  };
  onMount(() => seedFromDraft(props.episode.id));
  createEffect(
    on(
      () => props.episode.id,
      (episodeId) => {
        // What was typed belongs to the visit it was typed in; its save is already bound to it.
        void saver.flush();
        edits += 1;
        const stored = diagnosisToDraft(props.episode.diagnosis);
        setText(stored.text);
        setIcd10(stored.icd10);
        status.reset();
        setErrors({});
        seedFromDraft(episodeId);
      },
      { defer: true },
    ),
  );
  onCleanup(() => {
    void saver.flush();
    saver.dispose();
  });

  const change = (nextText: string, nextCode: string): void => {
    edits += 1;
    setText(nextText);
    setIcd10(nextCode);
    status.touch();
    saver.edit({ text: nextText, icd10: nextCode });
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
          change(event.currentTarget.value, icd10());
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
          change(text(), event.currentTarget.value.toUpperCase());
          setErrors(({ icd10: _cleared, ...rest }) => rest);
        }}
      />
      <DraftStatus state={status.state()} class="episode-diagnosis__status" />
    </div>
  );
}
