import { Combobox } from '@kobalte/core/combobox';
import { createEffect, createMemo, createSignal, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { PatientAvatar } from '@/components/PatientAvatar';
import { PatientQuickCreate } from '@/components/PatientQuickCreate';
import { PatientVaultUnlock } from '@/components/PatientVaultUnlock';
import type { PatientProfile, PatientVaultSnapshot } from '@/state/patient-domain';

type PatientCaseOption = PatientProfile & { readonly searchText: string };

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
  readonly onSnapshotChange: (snapshot: PatientVaultSnapshot) => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [unlocking, setUnlocking] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [query, setQuery] = createSignal(props.subjectLabel);
  const options = createMemo<PatientCaseOption[]>(() =>
    props.unlocked
      ? props.profiles.map((profile) => ({
          ...profile,
          searchText: [profile.displayName, profile.localRecordNumber].filter(Boolean).join(' '),
        }))
      : [],
  );
  const selectedOption = createMemo(
    () => options().find((option) => option.id === props.patientId) ?? null,
  );
  createEffect(() => setQuery(props.subjectLabel));
  createEffect(() => {
    if (!props.unlocked) setCreating(false);
  });
  return (
    <Combobox<PatientCaseOption>
      class={`patient-case-combobox${props.class ? ` ${props.class}` : ''}`}
      open={open()}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          setUnlocking(false);
          setCreating(false);
        }
      }}
      options={options()}
      value={selectedOption()}
      optionValue="id"
      optionLabel="displayName"
      optionTextValue="searchText"
      defaultFilter={(option, inputValue) => matchesPatient(option.searchText, inputValue)}
      allowsEmptyCollection
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
        if (props.patientId && value !== selectedOption()?.displayName) props.onPatientChange('');
        if (!props.patientId || value !== selectedOption()?.displayName)
          props.onSubjectLabelChange(value);
      }}
      onChange={(option) => {
        if (option) {
          props.onPatientChange(option.id);
          setOpen(false);
        }
      }}
      itemComponent={(itemProps) => (
        <Combobox.Item class="patient-case-combobox__item" item={itemProps.item}>
          <PatientAvatar
            name={itemProps.item.rawValue.displayName}
            avatar={itemProps.item.rawValue.avatar}
          />
          <Combobox.ItemLabel class="patient-case-combobox__item-label">
            {itemProps.item.rawValue.displayName}
          </Combobox.ItemLabel>
        </Combobox.Item>
      )}
    >
      <Combobox.HiddenSelect />
      <Combobox.Label class="patient-case-combobox__label">
        Пациент / случай — необязательно
      </Combobox.Label>
      <Combobox.Control
        class="patient-case-combobox__control"
        classList={{ 'patient-case-combobox__control--patient': Boolean(selectedOption()) }}
      >
        <Show when={selectedOption()}>
          {(patient) => (
            <span class="patient-case-combobox__avatar">
              <PatientAvatar name={patient().displayName} avatar={patient().avatar} />
            </span>
          )}
        </Show>
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
          <Show
            when={unlocking()}
            fallback={
              <Show
                when={props.unlocked}
                fallback={
                  <button
                    class="patient-case-combobox__action"
                    type="button"
                    onClick={() => setUnlocking(true)}
                  >
                    <AppGlyph name="lock" class="patient-case-combobox__item-icon" />
                    Разблокировать пациентов
                  </button>
                }
              >
                <Show
                  when={!creating()}
                  fallback={
                    <PatientQuickCreate
                      initialName={props.patientId ? '' : props.subjectLabel}
                      onCreated={(snapshot, patientId) => {
                        props.onSnapshotChange(snapshot);
                        props.onPatientChange(patientId);
                        setCreating(false);
                        setOpen(false);
                      }}
                      onCancel={() => setCreating(false)}
                    />
                  }
                >
                  <Combobox.Listbox class="patient-case-combobox__listbox" />
                  <Show
                    when={!options().some((option) => matchesPatient(option.searchText, query()))}
                  >
                    <p class="patient-case-combobox__empty">Пациенты не найдены</p>
                  </Show>
                  <button
                    class="patient-case-combobox__action"
                    type="button"
                    onClick={() => {
                      setCreating(true);
                    }}
                  >
                    <AppGlyph name="plus" class="patient-case-combobox__item-icon" />
                    Добавить пациента
                  </button>
                </Show>
              </Show>
            }
          >
            <PatientVaultUnlock
              onUnlocked={(snapshot) => {
                props.onSnapshotChange(snapshot);
                setUnlocking(false);
                setOpen(true);
              }}
            />
          </Show>
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox>
  );
}
