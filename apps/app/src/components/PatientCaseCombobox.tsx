import { Combobox } from '@kobalte/core/combobox';
import { createEffect, createMemo, createSignal, type JSX } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import type { PatientProfile } from '@/state/patient-domain';

type PatientCaseOption =
  | {
      readonly kind: 'patient';
      readonly id: string;
      readonly label: string;
      readonly searchText: string;
    }
  | { readonly kind: 'unlock'; readonly id: 'unlock-patients'; readonly label: string };

const UNLOCK_OPTION: PatientCaseOption = {
  kind: 'unlock',
  id: 'unlock-patients',
  label: 'Разблокировать пациентов',
};

function matchesPatient(label: string, query: string): boolean {
  return label.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU'));
}

export function PatientCaseCombobox(props: {
  readonly profiles: readonly PatientProfile[];
  readonly patientId: string;
  readonly subjectLabel: string;
  readonly unlocked: boolean;
  readonly class?: string;
  readonly onPatientChange: (patientId: string) => void;
  readonly onSubjectLabelChange: (label: string) => void;
  readonly onUnlock: () => void;
}): JSX.Element {
  const [query, setQuery] = createSignal(props.subjectLabel);
  const patientOptions = createMemo<readonly PatientCaseOption[]>(() =>
    props.profiles.map((profile) => ({
      kind: 'patient',
      id: profile.id,
      label: profile.displayName,
      searchText: [profile.displayName, profile.localRecordNumber].filter(Boolean).join(' '),
    })),
  );
  const options = createMemo<PatientCaseOption[]>(() => {
    const patients = patientOptions();
    const hasMatch = patients.some(
      (option) => option.kind === 'patient' && matchesPatient(option.searchText, query()),
    );
    return !props.unlocked || !hasMatch ? [...patients, UNLOCK_OPTION] : [...patients];
  });
  const selectedOption = createMemo(
    () =>
      options().find((option) => option.kind === 'patient' && option.id === props.patientId) ??
      null,
  );

  createEffect(() => setQuery(props.subjectLabel));

  return (
    <Combobox<PatientCaseOption>
      class={`patient-case-combobox${props.class ? ` ${props.class}` : ''}`}
      options={options()}
      value={selectedOption()}
      optionValue="id"
      optionLabel="label"
      optionTextValue={(option) => (option.kind === 'patient' ? option.searchText : option.label)}
      defaultFilter={(option, inputValue) =>
        option.kind === 'unlock' || matchesPatient(option.searchText, inputValue)
      }
      noResetInputOnBlur
      triggerMode="input"
      sameWidth
      fitViewport
      gutter={6}
      modal={false}
      preventScroll={false}
      placeholder="Имя, номер карты или псевдоним"
      onInputChange={(value) => {
        setQuery(value);
        if (props.patientId && value !== selectedOption()?.label) props.onPatientChange('');
        if (!props.patientId || value !== selectedOption()?.label) {
          props.onSubjectLabelChange(value);
        }
      }}
      onChange={(option) => {
        if (!option) return;
        if (option.kind === 'unlock') {
          props.onUnlock();
          return;
        }
        setQuery(option.label);
        props.onPatientChange(option.id);
      }}
      itemComponent={(itemProps) => (
        <Combobox.Item class="patient-case-combobox__item" item={itemProps.item}>
          {itemProps.item.rawValue.kind === 'unlock' ? (
            <AppGlyph name="lock" class="patient-case-combobox__item-icon" />
          ) : (
            <span class="patient-case-combobox__item-spacer" aria-hidden="true" />
          )}
          <Combobox.ItemLabel class="patient-case-combobox__item-label">
            {itemProps.item.rawValue.label}
          </Combobox.ItemLabel>
        </Combobox.Item>
      )}
    >
      <Combobox.HiddenSelect />
      <Combobox.Label class="patient-case-combobox__label">
        Пациент / случай — необязательно
      </Combobox.Label>
      <Combobox.Control class="patient-case-combobox__control">
        <Combobox.Input class="patient-case-combobox__input" value={props.subjectLabel} />
        <Combobox.Trigger
          class="patient-case-combobox__trigger"
          aria-label="Показать пациентов"
          title="Показать пациентов"
        >
          <AppGlyph name="caret-down" class="patient-case-combobox__trigger-icon" />
        </Combobox.Trigger>
      </Combobox.Control>
      <Combobox.Portal>
        <Combobox.Content class="patient-case-combobox__content">
          <Combobox.Listbox class="patient-case-combobox__listbox" />
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox>
  );
}
