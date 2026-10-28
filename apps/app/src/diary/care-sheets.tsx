import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { Button } from '@/components/Button';
import { DiarySheet, GrowingText } from '@/diary/DiarySheet';
import { inputModeFor, numberProblem, parseTypedNumber, rangeHint } from '@/diary/diary-validation';
import { atTime, CARE_DOSE_FIELD, dayKey } from '@/features/diary/diary-care';
import {
  createDiaryId,
  DIARY_MEAL_LABEL,
  type DiaryCheckpoint,
  type DiaryDoseTime,
  type DiaryEntry,
  type DiaryField,
  type DiaryInvitation,
  type DiaryPlanItem,
  type DiaryPlanValue,
} from '@/features/diary/diary-model';

/** Saves an entry; returns the problem to show, or undefined when it was saved. */
export type CareSave = (value: Record<string, unknown>) => string | undefined;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function clock(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The time a new mark starts with: now on today, the planned time on another day. */
function initialTime(day: string, planned: string | undefined): string {
  if (day === dayKey(new Date())) return clock(new Date().toISOString());
  return planned ?? '12:00';
}

function TimeField(props: { readonly value: string; readonly onInput: (value: string) => void }) {
  return (
    <label class="diary-care-time">
      <span class="diary-care-time__label">Время</span>
      <input
        class="diary-care-time__input"
        type="time"
        required
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
    </label>
  );
}

function TipBox(props: { readonly text: string | undefined }) {
  return (
    <Show when={props.text}>
      <p class="diary-care-tip">
        <span class="diary-care-tip__mark" aria-hidden="true">
          ?
        </span>
        <span class="diary-care-tip__text">{props.text}</span>
      </p>
    </Show>
  );
}

function SheetFooter(props: {
  readonly error: string;
  readonly saveLabel?: string;
  readonly onSave: () => void;
  readonly onRemove?: (() => void) | undefined;
}): JSX.Element {
  // Deleting asks once more in place: the button turns into «Точно удалить?» for a few seconds.
  const [confirming, setConfirming] = createSignal(false);
  let timer: number | undefined;
  onCleanup(() => window.clearTimeout(timer));
  const remove = (): void => {
    if (!confirming()) {
      setConfirming(true);
      timer = window.setTimeout(() => setConfirming(false), 4000);
      return;
    }
    window.clearTimeout(timer);
    props.onRemove?.();
  };
  return (
    <>
      <Show when={props.error}>
        <p class="diary-care-error" role="alert">
          {props.error}
        </p>
      </Show>
      <div class="diary-care-actions">
        <Show when={props.onRemove}>
          <Button
            class="diary-button diary-button--danger"
            classList={{ 'diary-button--confirm': confirming() }}
            variant="quiet"
            onClick={remove}
          >
            {confirming() ? 'Точно удалить?' : 'Удалить'}
          </Button>
        </Show>
        <Button
          class="diary-button diary-care-actions__save"
          variant="primary"
          onClick={props.onSave}
        >
          {props.saveLabel ?? 'Сохранить'}
        </Button>
      </div>
    </>
  );
}

function doseTitle(item: DiaryPlanItem, time: DiaryDoseTime | undefined): string {
  return [item.name, time?.dose ?? item.dose].filter(Boolean).join(' ');
}

/**
 * Marks one intake: taken or skipped, when, and how the patient feels after it (the doctor's
 * effect list and free text).
 */
export function DoseSheet(props: {
  readonly invitation: DiaryInvitation;
  readonly day: string;
  readonly item: DiaryPlanItem;
  readonly time: DiaryDoseTime | undefined;
  readonly entry: DiaryEntry | undefined;
  readonly tip: string | undefined;
  readonly onSave: CareSave;
  readonly onRemove: (entry: DiaryEntry) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const previous = props.entry?.values[CARE_DOSE_FIELD] as DiaryPlanValue | undefined;
  const afterField = props.invitation.fields.find((field) => field.id === 'after');
  const [taken, setTaken] = createSignal(previous?.done !== false);
  const [time, setTime] = createSignal(
    props.entry ? clock(props.entry.at) : initialTime(props.day, props.time?.time),
  );
  const [after, setAfter] = createSignal<readonly string[]>(
    (props.entry?.values['after'] as readonly string[] | undefined) ?? [],
  );
  const [note, setNote] = createSignal(props.entry?.note ?? '');
  const [error, setError] = createSignal('');

  const toggle = (option: string): void => {
    setAfter((current) =>
      current.includes(option) ? current.filter((value) => value !== option) : [...current, option],
    );
  };

  const save = (): void => {
    const problem = props.onSave({
      id: props.entry?.id ?? createDiaryId(),
      at: atTime(props.day, time()),
      values: {
        [CARE_DOSE_FIELD]: {
          item: props.item.id,
          done: taken(),
          ...(props.time ? { slot: props.time.time } : {}),
        },
        ...(taken() && after().length ? { after: after() } : {}),
      },
      ...(note().trim() ? { note: note() } : {}),
    });
    setError(problem ?? '');
  };

  const subtitle = (): string | undefined => {
    if (!props.time) return props.item.asNeeded ? 'При необходимости' : undefined;
    return [props.time.time, props.time.meal ? DIARY_MEAL_LABEL[props.time.meal] : '']
      .filter(Boolean)
      .join(' · ');
  };

  return (
    <DiarySheet
      title={doseTitle(props.item, props.time)}
      subtitle={subtitle()}
      onClose={props.onClose}
      footer={
        <SheetFooter
          error={error()}
          onSave={save}
          onRemove={props.entry ? () => props.entry && props.onRemove(props.entry) : undefined}
        />
      }
    >
      <TipBox text={props.tip} />
      <fieldset class="diary-segment">
        <legend class="diary-hidden-label">Приём</legend>
        <button
          type="button"
          class="diary-segment__option"
          classList={{ 'diary-segment__option--on': taken() }}
          aria-pressed={taken()}
          onClick={() => setTaken(true)}
        >
          Принял(а)
        </button>
        <button
          type="button"
          class="diary-segment__option"
          classList={{ 'diary-segment__option--on': !taken() }}
          aria-pressed={!taken()}
          onClick={() => setTaken(false)}
        >
          Пропустил(а)
        </button>
      </fieldset>
      <TimeField value={time()} onInput={setTime} />
      <Show when={taken() && afterField?.options?.length}>
        <fieldset class="diary-chips">
          <legend class="diary-chips__legend">Как вы себя чувствуете после приёма?</legend>
          <div class="diary-chips__list">
            <For each={afterField?.options ?? []}>
              {(option) => (
                <button
                  type="button"
                  class="diary-chip"
                  classList={{ 'diary-chip--on': after().includes(option) }}
                  aria-pressed={after().includes(option)}
                  onClick={() => toggle(option)}
                >
                  {option}
                </button>
              )}
            </For>
          </div>
        </fieldset>
      </Show>
      <GrowingText
        label={taken() ? 'Что ещё заметили' : 'Почему пропустили'}
        value={note()}
        placeholder={taken() ? 'Опишите ваши ощущения' : 'Например: забыл(а), закончились таблетки'}
        onInput={setNote}
      />
    </DiarySheet>
  );
}

const SCORE_WORDS: Readonly<Record<number, string>> = {
  0: 'очень плохо',
  5: 'средне',
  10: 'отлично',
};

/** A 0–10 score (wellbeing in the morning or evening) with an optional comment. */
export function ScoreSheet(props: {
  readonly day: string;
  readonly checkpoint: DiaryCheckpoint;
  readonly field: DiaryField;
  readonly time: string | undefined;
  readonly entry: DiaryEntry | undefined;
  readonly tip: string | undefined;
  readonly onSave: CareSave;
  readonly onRemove: (entry: DiaryEntry) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const min = props.field.min ?? 0;
  const max = props.field.max ?? 10;
  const scores = Array.from({ length: max - min + 1 }, (_, index) => min + index);
  const previous = props.entry?.values[props.field.id];
  const [score, setScore] = createSignal<number | undefined>(
    typeof previous === 'number' ? previous : undefined,
  );
  const [time, setTime] = createSignal(
    props.entry ? clock(props.entry.at) : initialTime(props.day, props.time),
  );
  const [note, setNote] = createSignal(props.entry?.note ?? '');
  const [error, setError] = createSignal('');

  const save = (): void => {
    const value = score();
    if (value === undefined) {
      setError('Выберите оценку от 0 до 10.');
      return;
    }
    setError(
      props.onSave({
        id: props.entry?.id ?? createDiaryId(),
        at: atTime(props.day, time()),
        check: props.checkpoint.id,
        values: { [props.field.id]: value },
        ...(note().trim() ? { note: note() } : {}),
      }) ?? '',
    );
  };

  return (
    <DiarySheet
      title={props.checkpoint.label}
      subtitle="0 — очень плохо, 10 — отлично"
      onClose={props.onClose}
      footer={
        <SheetFooter
          error={error()}
          onSave={save}
          onRemove={props.entry ? () => props.entry && props.onRemove(props.entry) : undefined}
        />
      }
    >
      <TipBox text={props.tip} />
      <fieldset class="diary-score">
        <legend class="diary-hidden-label">{props.checkpoint.label}</legend>
        <For each={scores}>
          {(value) => (
            <button
              type="button"
              class={`diary-score__option diary-score__option--tone-${Math.round(((value - min) / (max - min)) * 4)}`}
              classList={{ 'diary-score__option--on': score() === value }}
              aria-pressed={score() === value}
              aria-label={SCORE_WORDS[value] ? `${value}, ${SCORE_WORDS[value]}` : String(value)}
              onClick={() => setScore(value)}
            >
              {value}
            </button>
          )}
        </For>
      </fieldset>
      <TimeField value={time()} onInput={setTime} />
      <GrowingText
        label="Комментарий"
        value={note()}
        placeholder="Опишите, что повлияло на самочувствие"
        onInput={setNote}
      />
    </DiarySheet>
  );
}

/** Several measurements at once (pulse, pressure, saturation), with the diary's range checks. */
export function VitalsSheet(props: {
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
  const fields = (props.checkpoint.fields ?? []).flatMap((id) => {
    const field = props.invitation.fields.find((candidate) => candidate.id === id);
    return field ? [field] : [];
  });
  const [texts, setTexts] = createSignal<Record<string, string>>(
    Object.fromEntries(
      fields.map((field) => {
        const value = props.entry?.values[field.id];
        return [field.id, typeof value === 'number' ? String(value) : ''];
      }),
    ),
  );
  const [time, setTime] = createSignal(
    props.entry ? clock(props.entry.at) : initialTime(props.day, props.time),
  );
  const [problems, setProblems] = createSignal<Record<string, string>>({});
  const [error, setError] = createSignal('');

  const save = (): void => {
    const found: Record<string, string> = {};
    const values: Record<string, number> = {};
    for (const field of fields) {
      const text = texts()[field.id] ?? '';
      const problem = numberProblem(field, text);
      if (problem) found[field.id] = problem;
      const number = parseTypedNumber(text);
      if (!problem && number !== undefined) values[field.id] = number;
    }
    setProblems(found);
    if (Object.keys(found).length) {
      setError('Проверьте отмеченные поля.');
      return;
    }
    if (!Object.keys(values).length) {
      setError('Заполните хотя бы одно поле.');
      return;
    }
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
      subtitle="Заполните то, что измерили"
      onClose={props.onClose}
      footer={
        <SheetFooter
          error={error()}
          onSave={save}
          onRemove={props.entry ? () => props.entry && props.onRemove(props.entry) : undefined}
        />
      }
    >
      <TipBox text={props.tip} />
      <div class="diary-vitals">
        <For each={fields}>
          {(field) => (
            <label class="diary-vitals__field">
              <span class="diary-vitals__label">
                {field.label}
                <Show when={field.unit}>
                  <span class="diary-vitals__unit">, {field.unit}</span>
                </Show>
              </span>
              <span class="diary-vitals__row">
                <input
                  class="diary-vitals__input"
                  classList={{ 'diary-vitals__input--invalid': Boolean(problems()[field.id]) }}
                  inputmode={inputModeFor(field)}
                  enterkeyhint="next"
                  value={texts()[field.id] ?? ''}
                  placeholder={rangeHint(field)}
                  aria-invalid={Boolean(problems()[field.id])}
                  onInput={(event) => {
                    const value = event.currentTarget.value;
                    setTexts((current) => ({ ...current, [field.id]: value }));
                    // The field turns calm again as soon as the patient changes it.
                    if (problems()[field.id]) {
                      setProblems(({ [field.id]: _fixed, ...rest }) => rest);
                    }
                  }}
                />
              </span>
              <Show when={problems()[field.id]}>
                <span class="diary-vitals__problem">{problems()[field.id]}</span>
              </Show>
            </label>
          )}
        </For>
      </div>
      <TimeField value={time()} onInput={setTime} />
    </DiarySheet>
  );
}

/** «Описание состояния»: a time and the patient's own words. */
export function NoteSheet(props: {
  readonly day: string;
  readonly entry: DiaryEntry | undefined;
  readonly onSave: CareSave;
  readonly onRemove: (entry: DiaryEntry) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const previous = props.entry?.values['state'];
  const [time, setTime] = createSignal(
    props.entry ? clock(props.entry.at) : initialTime(props.day, undefined),
  );
  const [text, setText] = createSignal(typeof previous === 'string' ? previous : '');
  const [error, setError] = createSignal('');

  const save = (): void => {
    if (!text().trim()) {
      setError('Опишите, что вы чувствуете.');
      return;
    }
    setError(
      props.onSave({
        id: props.entry?.id ?? createDiaryId(),
        at: atTime(props.day, time()),
        values: { state: text() },
      }) ?? '',
    );
  };

  return (
    <DiarySheet
      title={props.entry ? 'Описание состояния' : 'Добавить описание состояния'}
      onClose={props.onClose}
      footer={
        <SheetFooter
          error={error()}
          onSave={save}
          onRemove={props.entry ? () => props.entry && props.onRemove(props.entry) : undefined}
        />
      }
    >
      <TimeField value={time()} onInput={setTime} />
      <GrowingText
        label="Что вы чувствуете"
        value={text()}
        placeholder="Настроение, сон, тревога, побочные эффекты — своими словами"
        autofocus={!props.entry}
        onInput={setText}
      />
    </DiarySheet>
  );
}

/** A doctor's own section: a description in the patient's words, or one of a few variants. */
export function AnswerSheet(props: {
  readonly day: string;
  readonly checkpoint: DiaryCheckpoint;
  readonly field: DiaryField;
  readonly time: string | undefined;
  readonly entry: DiaryEntry | undefined;
  readonly tip: string | undefined;
  readonly onSave: CareSave;
  readonly onRemove: (entry: DiaryEntry) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const previous = props.entry?.values[props.field.id];
  const [answer, setAnswer] = createSignal(typeof previous === 'string' ? previous : '');
  const [time, setTime] = createSignal(
    props.entry ? clock(props.entry.at) : initialTime(props.day, props.time),
  );
  const [note, setNote] = createSignal(props.entry?.note ?? '');
  const [error, setError] = createSignal('');
  const choice = (): boolean => props.field.type === 'choice';

  const save = (): void => {
    if (!answer().trim()) {
      setError(choice() ? 'Выберите вариант.' : 'Напишите пару слов.');
      return;
    }
    setError(
      props.onSave({
        id: props.entry?.id ?? createDiaryId(),
        at: atTime(props.day, time()),
        check: props.checkpoint.id,
        values: { [props.field.id]: answer() },
        ...(choice() && note().trim() ? { note: note() } : {}),
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
          onSave={save}
          onRemove={props.entry ? () => props.entry && props.onRemove(props.entry) : undefined}
        />
      }
    >
      <TipBox text={props.tip} />
      <Show
        when={choice()}
        fallback={
          <GrowingText
            label={props.checkpoint.label}
            value={answer()}
            placeholder="Своими словами"
            autofocus={!props.entry}
            onInput={setAnswer}
          />
        }
      >
        <fieldset class="diary-answer">
          <legend class="diary-hidden-label">{props.checkpoint.label}</legend>
          <For each={props.field.options ?? []}>
            {(option) => (
              <button
                type="button"
                class="diary-answer__option"
                classList={{ 'diary-answer__option--on': answer() === option }}
                aria-pressed={answer() === option}
                onClick={() => setAnswer(option)}
              >
                {option}
              </button>
            )}
          </For>
        </fieldset>
      </Show>
      <TimeField value={time()} onInput={setTime} />
      <Show when={choice()}>
        <GrowingText
          label="Комментарий"
          value={note()}
          placeholder="Опишите ваши ощущения"
          onInput={setNote}
        />
      </Show>
    </DiarySheet>
  );
}
