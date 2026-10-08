import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { createDebouncedValue } from '@/components/debounced-value';
import { OverlayDialog } from '@/components/OverlayDialog';
import { PatientAvatar } from '@/components/PatientAvatar';
import { PatientQuickCreate } from '@/components/PatientQuickCreate';
import { PatientVaultUnlock } from '@/components/PatientVaultUnlock';
import { patientRowSummary } from '@/components/patient-picker-summary';
import { TextField } from '@/components/TextField';
import type { PatientProfile, PatientVaultSnapshot } from '@/state/patient-domain';

import '@/components/PatientPickerRow.css';

/** Below this many patients the list is short enough to scan without a search field. */
const SEARCH_MIN_PATIENTS = 6;
const SEARCH_DEBOUNCE_MS = 150;

export interface PatientPickerRowProps {
  readonly profiles: readonly PatientProfile[];
  /** Id of the chosen patient, or an empty string for none. */
  readonly patientId: string;
  /** The vault is open and `profiles` is its content. */
  readonly unlocked: boolean;
  readonly class?: string;
  /** Second line while nobody is chosen. */
  readonly hint?: string;
  /** Offer «Без пациента» in the chooser; on by default. */
  readonly allowNone?: boolean;
  readonly onPatientChange: (patientId: string) => void;
  readonly onSnapshotChange: (snapshot: PatientVaultSnapshot) => void;
}

function matches(profile: PatientProfile, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  if (!needle) return true;
  return [profile.displayName, profile.localRecordNumber]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('ru-RU')
    .includes(needle);
}

/**
 * Patient choice for every tool that can use a patient's data (forms, questionnaires,
 * calculators): one compact row — «Пациент · Выберите, чтобы подставить данные» and a round
 * button — which shows avatar, name and birth date once somebody is chosen. The button opens the
 * chooser sheet: unlock the vault, search, pick, or add a patient.
 */
export function PatientPickerRow(props: PatientPickerRowProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const settledQuery = createDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const selected = createMemo(() =>
    props.unlocked ? props.profiles.find((profile) => profile.id === props.patientId) : undefined,
  );
  const sorted = createMemo(() =>
    props.profiles.toSorted((left, right) =>
      left.displayName.localeCompare(right.displayName, 'ru-RU'),
    ),
  );
  const visible = createMemo(() => sorted().filter((profile) => matches(profile, settledQuery())));
  const summary = (profile: PatientProfile): string | undefined =>
    patientRowSummary(profile.birthDate, new Date().toISOString().slice(0, 10));

  const close = (): void => {
    setOpen(false);
    setCreating(false);
    setQuery('');
  };
  const choose = (patientId: string): void => {
    props.onPatientChange(patientId);
    close();
  };
  const buttonLabel = (): string => (selected() ? 'Выбрать другого пациента' : 'Выбрать пациента');

  return (
    <div class={`patient-picker-row${props.class ? ` ${props.class}` : ''}`}>
      <Show
        when={selected()}
        fallback={
          <>
            <PatientAvatar name="" class="patient-picker-row__avatar" />
            <div class="patient-picker-row__text">
              <span class="patient-picker-row__title">Пациент</span>
              <span class="patient-picker-row__subtitle">
                {props.hint ?? 'Выберите, чтобы подставить данные'}
              </span>
            </div>
          </>
        }
      >
        {(patient) => (
          <>
            <PatientAvatar
              name={patient().displayName}
              avatar={patient().avatar}
              class="patient-picker-row__avatar"
            />
            <div class="patient-picker-row__text">
              <span class="patient-picker-row__title patient-picker-row__title--name">
                {patient().displayName}
              </span>
              <Show when={summary(patient())}>
                {(text) => <span class="patient-picker-row__subtitle">{text()}</span>}
              </Show>
            </div>
          </>
        )}
      </Show>
      <Button
        type="button"
        variant="icon"
        class="knowledge-back-button patient-picker-row__button"
        aria-label={buttonLabel()}
        title={buttonLabel()}
        aria-haspopup="dialog"
        icon={<AppGlyph name="users" />}
        onClick={() => setOpen(true)}
      />

      <OverlayDialog
        open={open()}
        title="Пациент"
        tracksHistory={false}
        class="patient-picker-dialog"
        bodyClass="patient-picker-dialog__body"
        onClose={close}
      >
        <Show
          when={props.unlocked}
          fallback={
            <PatientVaultUnlock
              onUnlocked={(snapshot) => {
                props.onSnapshotChange(snapshot);
              }}
            />
          }
        >
          <Show
            when={!creating()}
            fallback={
              <PatientQuickCreate
                initialName=""
                onCreated={(snapshot, patientId) => {
                  props.onSnapshotChange(snapshot);
                  choose(patientId);
                }}
                onCancel={() => setCreating(false)}
              />
            }
          >
            <Show when={props.profiles.length >= SEARCH_MIN_PATIENTS}>
              <TextField
                label="Поиск пациента"
                hideLabel
                type="search"
                class="patient-picker-dialog__search"
                placeholder="Имя или номер карты"
                autocomplete="off"
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </Show>
            <ul class="patient-picker-dialog__list">
              <Show when={props.patientId && (props.allowNone ?? true)}>
                <li>
                  <button
                    type="button"
                    class="patient-picker-dialog__option"
                    onClick={() => choose('')}
                  >
                    <PatientAvatar name="" class="patient-picker-row__avatar" />
                    <span class="patient-picker-dialog__name">Без пациента</span>
                  </button>
                </li>
              </Show>
              <For each={visible()}>
                {(profile) => (
                  <li>
                    <button
                      type="button"
                      class="patient-picker-dialog__option"
                      classList={{
                        'patient-picker-dialog__option--selected': profile.id === props.patientId,
                      }}
                      aria-current={profile.id === props.patientId ? 'true' : undefined}
                      onClick={() => choose(profile.id)}
                    >
                      <PatientAvatar
                        name={profile.displayName}
                        avatar={profile.avatar}
                        class="patient-picker-row__avatar"
                      />
                      <span class="patient-picker-dialog__text">
                        <span class="patient-picker-dialog__name">{profile.displayName}</span>
                        <Show when={summary(profile)}>
                          {(text) => <span class="patient-picker-row__subtitle">{text()}</span>}
                        </Show>
                      </span>
                      <Show when={profile.id === props.patientId}>
                        <AppGlyph name="check" class="patient-picker-dialog__check" />
                      </Show>
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <Show when={visible().length === 0}>
              <p class="patient-picker-dialog__empty">
                {props.profiles.length === 0 ? 'Пациентов пока нет' : 'Никого не нашли'}
              </p>
            </Show>
            <button
              type="button"
              class="patient-picker-dialog__add"
              onClick={() => setCreating(true)}
            >
              <AppGlyph name="plus" class="patient-picker-dialog__add-icon" />
              Добавить пациента
            </button>
          </Show>
        </Show>
      </OverlayDialog>
    </div>
  );
}
