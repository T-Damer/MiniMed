import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import {
  type CareSave,
  clock,
  initialTime,
  ScorePicker,
  SheetFooter,
  TimeField,
  TipBox,
} from '@/diary/care-sheets';
import { DiarySheet, GrowingText } from '@/diary/DiarySheet';
import { atTime } from '@/features/diary/diary-care';
import {
  createDiaryId,
  type DiaryCheckpoint,
  type DiaryEntry,
  type DiaryInvitation,
} from '@/features/diary/diary-model';
import {
  pluralForm,
  substanceByField,
  USE_CRAVING_FIELD,
  USE_WHAT_FIELD,
} from '@/features/diary/diary-substances';

const CRAVING_WORDS: Readonly<Record<number, string>> = {
  0: 'тяги нет',
  10: 'очень сильная',
};

/** Keeps a typed amount a whole number within the field's ceiling. */
function typedAmount(text: string, max: number): number {
  const digits = text.replace(/\D/gu, '');
  return digits ? Math.min(max, Number(digits)) : 0;
}

/**
 * The day's substance use: «Ничего не было» saves zeros for everything at once; otherwise a
 * stepper per substance the doctor asked about (0 reads «не было»), the craving 0–10 and, when a
 * medicine without a prescription was taken, a few words on what it was.
 */
export function UseSheet(props: {
  readonly invitation: DiaryInvitation;
  readonly day: string;
  readonly checkpoint: DiaryCheckpoint;
  readonly time: string | undefined;
  readonly entry: DiaryEntry | undefined;
  readonly tip: string | undefined;
  readonly onSave: CareSave;
  readonly onRemove: (entry: DiaryEntry) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const asked = (props.checkpoint.fields ?? []).flatMap((id) => {
    const field = props.invitation.fields.find((candidate) => candidate.id === id);
    return field ? [field] : [];
  });
  const counts = asked.filter((field) => field.type === 'count');
  const cravingField = asked.find((field) => field.id === USE_CRAVING_FIELD);
  const whatField = asked.find((field) => field.id === USE_WHAT_FIELD);
  const before = props.entry?.values ?? {};

  const [amounts, setAmounts] = createSignal<Readonly<Record<string, number>>>(
    Object.fromEntries(
      counts.map((field) => {
        const value = before[field.id];
        return [field.id, typeof value === 'number' ? value : 0];
      }),
    ),
  );
  const [craving, setCraving] = createSignal<number | undefined>(
    typeof before[USE_CRAVING_FIELD] === 'number' ? before[USE_CRAVING_FIELD] : undefined,
  );
  const [what, setWhat] = createSignal(
    typeof before[USE_WHAT_FIELD] === 'string' ? before[USE_WHAT_FIELD] : '',
  );
  const [time, setTime] = createSignal(
    props.entry ? clock(props.entry.at) : initialTime(props.day, props.time),
  );
  const [error, setError] = createSignal('');

  const ceiling = (id: string): number =>
    counts.find((field) => field.id === id)?.max ?? substanceByField(id)?.max ?? 99;
  const amountOf = (id: string): number => amounts()[id] ?? 0;
  const setAmount = (id: string, value: number): void => {
    setAmounts((current) => ({ ...current, [id]: Math.max(0, Math.min(ceiling(id), value)) }));
  };
  /** The «что именно» line is asked once a substance that wants it was used. */
  const asksWhat = (): boolean =>
    Boolean(whatField) &&
    counts.some((field) => substanceByField(field.id)?.asksWhat && amountOf(field.id) > 0);

  const write = (nothing: boolean): void => {
    const values: Record<string, number | string> = {};
    for (const field of counts) values[field.id] = nothing ? 0 : amountOf(field.id);
    const score = craving();
    if (cravingField && score !== undefined) values[cravingField.id] = score;
    const said = what().trim();
    if (!nothing && whatField && asksWhat() && said) values[whatField.id] = said;
    setError(
      props.onSave({
        id: props.entry?.id ?? createDiaryId(),
        at: atTime(props.day, time()),
        check: props.checkpoint.id,
        values,
      }) ?? '',
    );
  };

  return (
    <DiarySheet
      title={props.checkpoint.label}
      onClose={props.onClose}
      footer={
        <SheetFooter
          error={error()}
          onSave={() => write(false)}
          onRemove={props.entry ? () => props.entry && props.onRemove(props.entry) : undefined}
        />
      }
    >
      <TipBox text={props.tip} />
      <Button class="diary-button diary-use__none" variant="secondary" onClick={() => write(true)}>
        Ничего не было
      </Button>
      <ul class="diary-use__list">
        <For each={counts}>
          {(field) => {
            const substance = substanceByField(field.id);
            const label = substance?.label ?? field.label;
            return (
              <li class="diary-use__row">
                <Show when={substance}>
                  {(known) => <AppGlyph name={known().glyph} class="diary-use__glyph" />}
                </Show>
                <span class="diary-use__text">
                  <span class="diary-use__label">
                    {label}
                    <Show when={substance}>
                      {(known) => (
                        <span class="diary-use__unit">
                          , {pluralForm(amountOf(field.id), known().unit)}
                        </span>
                      )}
                    </Show>
                  </span>
                  <Show when={substance?.hint}>
                    <span class="diary-use__hint">{substance?.hint}</span>
                  </Show>
                </span>
                <span class="diary-use__stepper">
                  <button
                    type="button"
                    class="diary-use__step"
                    aria-label={`Меньше: ${label}`}
                    disabled={amountOf(field.id) <= 0}
                    onClick={() => setAmount(field.id, amountOf(field.id) - 1)}
                  >
                    <AppGlyph name="minus" class="diary-use__step-icon" />
                  </button>
                  <input
                    class="diary-use__value"
                    inputmode="numeric"
                    enterkeyhint="done"
                    autocomplete="off"
                    aria-label={`${label}: сколько`}
                    placeholder="не было"
                    value={amountOf(field.id) > 0 ? String(amountOf(field.id)) : ''}
                    onInput={(event) => {
                      const next = typedAmount(event.currentTarget.value, ceiling(field.id));
                      setAmount(field.id, next);
                      // A capped or non-numeric entry shows what was kept.
                      event.currentTarget.value = next > 0 ? String(next) : '';
                    }}
                  />
                  <button
                    type="button"
                    class="diary-use__step"
                    aria-label={`Больше: ${label}`}
                    disabled={amountOf(field.id) >= ceiling(field.id)}
                    onClick={() => setAmount(field.id, amountOf(field.id) + 1)}
                  >
                    <AppGlyph name="plus" class="diary-use__step-icon" />
                  </button>
                </span>
              </li>
            );
          }}
        </For>
      </ul>
      <Show when={asksWhat()}>
        <GrowingText
          label={whatField?.label ?? 'Что именно'}
          value={what()}
          placeholder="Название и сколько"
          onInput={setWhat}
        />
      </Show>
      <Show when={cravingField}>
        {(field) => (
          <div class="diary-use__craving">
            <p class="diary-use__craving-title">
              {field().label}
              <span class="diary-use__unit">, 0 — нет, 10 — очень сильная</span>
            </p>
            <ScorePicker
              label={field().label}
              min={field().min ?? 0}
              max={field().max ?? 10}
              value={craving()}
              words={CRAVING_WORDS}
              onChange={(value) => setCraving(craving() === value ? undefined : value)}
            />
          </div>
        )}
      </Show>
      <TimeField value={time()} onInput={setTime} />
    </DiarySheet>
  );
}
