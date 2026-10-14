import type { PrescriptionPatient } from '@localmed/contracts';
import { createEffect, createSignal, type JSX, on, Show } from 'solid-js';

import { ChoiceChip, ChoiceChipList } from '@/components/ChoiceChip';
import { createDebouncer } from '@/components/debounced-value';
import { SegmentedControl } from '@/components/SegmentedControl';
import { TextField } from '@/components/TextField';
import { parseTypedAge } from '@/features/medication-safety/age-limits';
import type { PatientCardFacts } from './prescription-facts';
import { ageText } from './prescription-safety';
import '@/styles/prescription.css';

const INPUT_DEBOUNCE_MS = 300;
const YEAR_DAYS = 365.25;

/** «6 лет», «8 мес», «3 года» or a bare number of years → days; null when it is not an age. */
export function parseAgeInput(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (clean === '') return null;
  const typed = parseTypedAge(clean);
  if (typed !== null) return typed;
  const years = Number(clean);
  return Number.isFinite(years) && years > 0 && years <= 120 ? Math.round(years * YEAR_DAYS) : null;
}

export function parseWeightInput(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) && value >= 0.4 && value <= 400 ? value : null;
}

type PatientGroupChoice = '' | 'child' | 'adult';

/**
 * Age, weight and state of the patient, as one compact row. The card of a chosen patient fills what
 * it knows; the doctor's own entries win over the card. Only the fields the arithmetic can use are
 * offered: height appears when a dose per body surface needs it, pregnancy and breastfeeding only
 * where they can apply.
 */
export function PrescriptionPatientFacts(props: {
  readonly patient: PrescriptionPatient;
  readonly card: PatientCardFacts;
  readonly needsHeight: boolean;
  readonly onChange: (patch: Partial<PrescriptionPatient>) => void;
}): JSX.Element {
  const [age, setAge] = createSignal('');
  const [weight, setWeight] = createSignal('');
  const [height, setHeight] = createSignal('');
  const ageDebounce = createDebouncer((text: string) => {
    const days = parseAgeInput(text);
    props.onChange({ ageDays: days, ...(days === null ? {} : { group: null }) });
  }, INPUT_DEBOUNCE_MS);
  const weightDebounce = createDebouncer((text: string) => {
    props.onChange({ weightKg: parseWeightInput(text) });
  }, INPUT_DEBOUNCE_MS);
  const heightDebounce = createDebouncer((text: string) => {
    props.onChange({ heightCm: parseWeightInput(text) });
  }, INPUT_DEBOUNCE_MS);

  // A restored draft fills the fields once.
  createEffect(
    on(
      () => props.patient,
      (patient) => {
        if (age() === '' && patient.ageDays !== null) setAge(ageText(patient.ageDays));
        if (weight() === '' && patient.weightKg !== null) setWeight(String(patient.weightKg));
        if (height() === '' && patient.heightCm !== null) setHeight(String(patient.heightCm));
      },
    ),
  );

  const cardAge = (): string | undefined =>
    props.card.ageDays === null ? undefined : ageText(props.card.ageDays);
  const cardWeight = (): string | undefined =>
    props.card.weightKg === null ? undefined : String(props.card.weightKg);
  const ageKnown = (): boolean => props.patient.ageDays !== null || props.card.ageDays !== null;
  const mayBePregnant = (): boolean => {
    if (props.card.sex === 'male') return false;
    const days = props.patient.ageDays ?? props.card.ageDays;
    return days === null || (days >= 12 * YEAR_DAYS && days < 60 * YEAR_DAYS);
  };

  const group = (): PatientGroupChoice => props.patient.group ?? '';
  const ageFromCard = (): boolean => age() === '' && cardAge() !== undefined;
  const weightFromCard = (): boolean => weight() === '' && cardWeight() !== undefined;

  return (
    <div class="prescription__facts" data-testid="prescription-facts">
      <div class="prescription__facts-row">
        <TextField
          class="prescription__fact"
          inputClass="prescription__fact-input"
          label="Возраст"
          value={age()}
          placeholder={cardAge() ?? 'лет, мес'}
          {...(ageFromCard() ? { hint: 'из карточки пациента' } : {})}
          autocomplete="off"
          inputmode="text"
          data-testid="prescription-age"
          onInput={(event) => {
            setAge(event.currentTarget.value);
            ageDebounce.call(event.currentTarget.value);
          }}
        />
        <TextField
          class="prescription__fact"
          inputClass="prescription__fact-input"
          label="Масса, кг"
          value={weight()}
          placeholder={cardWeight() ?? 'кг'}
          {...(weightFromCard() ? { hint: 'из карточки пациента' } : {})}
          autocomplete="off"
          inputmode="decimal"
          data-testid="prescription-weight"
          onInput={(event) => {
            setWeight(event.currentTarget.value);
            weightDebounce.call(event.currentTarget.value);
          }}
        />
        <Show when={props.needsHeight}>
          <TextField
            class="prescription__fact"
            inputClass="prescription__fact-input"
            label="Рост, см"
            value={height()}
            {...(props.card.heightCm === null ? {} : { placeholder: String(props.card.heightCm) })}
            autocomplete="off"
            inputmode="decimal"
            onInput={(event) => {
              setHeight(event.currentTarget.value);
              heightDebounce.call(event.currentTarget.value);
            }}
          />
        </Show>
      </div>
      <Show when={!ageKnown()}>
        <SegmentedControl<PatientGroupChoice>
          label="Возрастная группа"
          class="prescription__group"
          stretch
          value={group()}
          options={[
            { value: 'child', label: 'Ребёнок' },
            { value: 'adult', label: 'Взрослый' },
          ]}
          onChange={(next) => props.onChange({ group: next === '' ? null : next })}
        />
      </Show>
      <Show when={mayBePregnant()}>
        <ChoiceChipList label="Состояние пациента" class="prescription__states">
          <ChoiceChip
            compact
            accent={props.patient.pregnant || props.card.pregnant}
            aria-pressed={props.patient.pregnant || props.card.pregnant}
            onClick={() => props.onChange({ pregnant: !props.patient.pregnant })}
          >
            Беременность
          </ChoiceChip>
          <ChoiceChip
            compact
            accent={props.patient.lactating || props.card.lactating}
            aria-pressed={props.patient.lactating || props.card.lactating}
            onClick={() => props.onChange({ lactating: !props.patient.lactating })}
          >
            Грудное вскармливание
          </ChoiceChip>
        </ChoiceChipList>
      </Show>
    </div>
  );
}
