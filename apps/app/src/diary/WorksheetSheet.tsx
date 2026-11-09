import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';

import { DateField } from '@/components/DateField';
import { TimeField as UiTimeField } from '@/components/TimeField';
import {
  type CareSave,
  clock,
  initialTime,
  ScorePicker,
  SheetFooter,
  TimeField,
} from '@/diary/care-sheets';
import { DiarySheet, GrowingText } from '@/diary/DiarySheet';
import { LocalVoiceClips } from '@/diary/LocalVoiceClips';
import '@/diary/worksheet-fill.css';
import { createSpokenTracker } from '@/diary/spoken';
import { seenNote, VoiceNote } from '@/diary/VoiceNote';
import {
  assignmentPrintRows,
  assignmentWhat,
  cleanSheet,
  MAX_SHEET_LINE,
  worksheetSheetProblem,
} from '@/features/diary/diary-assignments';
import { atTime } from '@/features/diary/diary-care';
import {
  createDiaryId,
  type DiaryAssignment,
  type DiaryEntry,
  MAX_DIARY_SHEET_TEXT,
} from '@/features/diary/diary-model';
import { PrintManager } from '@/features/printing/print-manager';
import { PATIENT_MEMO } from '@/features/worksheets/assignment-memo';
import { worksheetPrintHtml } from '@/features/worksheets/worksheet-print';
import {
  activeWorksheetFields,
  type WorksheetField,
  worksheetPatientCare,
  worksheetPatientNote,
} from '@/state/user-worksheet-format';

type Cells = Record<string, unknown>;

function numberFrom(text: string): number | undefined {
  const parsed = Number(text.replace(',', '.').trim());
  return text.trim() && Number.isFinite(parsed) ? parsed : undefined;
}

/** «?» beside a field's name: the plain explanation opens under it, nothing shown until asked. */
function FieldHint(props: { readonly field: WorksheetField }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <Show when={props.field.patientHint}>
      <button
        type="button"
        class="worksheet-fill__hint-button"
        classList={{ 'worksheet-fill__hint-button--open': open() }}
        aria-expanded={open()}
        aria-label={`Что значит «${props.field.label}»`}
        onClick={() => setOpen(!open())}
      >
        ?
      </button>
      <Show when={open()}>
        <p class="worksheet-fill__hint">{props.field.patientHint}</p>
      </Show>
    </Show>
  );
}

/** One column of the sheet as a control the patient fills on a phone. */
function FieldInput(props: {
  readonly field: WorksheetField;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly onSpoken: (
    text: string,
    origin: Parameters<Parameters<typeof VoiceNote>[0]['onText']>[1],
  ) => void;
}): JSX.Element {
  const text = (): string => (typeof props.value === 'string' ? props.value : '');
  const number = (): number | undefined =>
    typeof props.value === 'number' ? props.value : undefined;
  const chosen = (): readonly string[] =>
    Array.isArray(props.value) ? (props.value as string[]) : [];
  const dictate = (said: string, origin: Parameters<typeof props.onSpoken>[1]): void => {
    props.onSpoken(said, origin);
    props.onChange(text().trim() ? `${text().trim()}\n${said}` : said);
  };
  return (
    <div class="worksheet-fill__field">
      <div class="worksheet-fill__label-row">
        <span class="worksheet-fill__label">{props.field.label}</span>
        <FieldHint field={props.field} />
      </div>
      <Switch>
        <Match when={props.field.type === 'long-text'}>
          <div class="worksheet-fill__with-voice">
            <GrowingText
              label={props.field.label}
              hideLabel
              maxLength={MAX_DIARY_SHEET_TEXT}
              value={text()}
              placeholder="Своими словами"
              onInput={props.onChange}
            />
            <VoiceNote compact={props.field.label} onText={dictate} />
          </div>
        </Match>
        <Match when={props.field.type === 'text'}>
          <div class="worksheet-fill__with-voice">
            <input
              class="worksheet-fill__input"
              aria-label={props.field.label}
              maxLength={MAX_SHEET_LINE}
              value={text()}
              onInput={(event) => props.onChange(event.currentTarget.value)}
            />
            <VoiceNote compact={props.field.label} onText={dictate} />
          </div>
        </Match>
        <Match when={props.field.type === 'scale'}>
          <ScorePicker
            label={props.field.label}
            min={0}
            max={10}
            value={number()}
            onChange={props.onChange}
          />
        </Match>
        <Match when={props.field.type === 'percent'}>
          <div class="worksheet-fill__percent">
            <input
              type="range"
              class="worksheet-fill__range"
              min={0}
              max={100}
              step={5}
              aria-label={`${props.field.label}, от 0 до 100`}
              value={number() ?? 0}
              classList={{ 'worksheet-fill__range--empty': number() === undefined }}
              onInput={(event) => props.onChange(Number(event.currentTarget.value))}
            />
            <span class="worksheet-fill__percent-value">
              {number() === undefined ? '— %' : `${number()} %`}
            </span>
          </div>
        </Match>
        <Match when={props.field.type === 'number' || props.field.type === 'duration'}>
          <div class="worksheet-fill__number">
            <input
              class="worksheet-fill__input worksheet-fill__input--number"
              aria-label={props.field.label}
              inputMode={props.field.type === 'duration' ? 'numeric' : 'decimal'}
              value={number()?.toString().replace('.', ',') ?? ''}
              onInput={(event) => props.onChange(numberFrom(event.currentTarget.value))}
            />
            <span class="worksheet-fill__unit">
              {props.field.type === 'duration' ? 'мин' : (props.field.unit ?? '')}
            </span>
          </div>
        </Match>
        <Match when={props.field.type === 'choice' || props.field.type === 'multi'}>
          <fieldset class="diary-answer">
            <legend class="diary-hidden-label">{props.field.label}</legend>
            <For each={props.field.options ?? []}>
              {(option) => {
                const on = (): boolean =>
                  props.field.type === 'choice'
                    ? props.value === option
                    : chosen().includes(option);
                return (
                  <button
                    type="button"
                    class="diary-answer__option"
                    classList={{ 'diary-answer__option--on': on() }}
                    aria-pressed={on()}
                    onClick={() => {
                      if (props.field.type === 'choice') props.onChange(on() ? undefined : option);
                      else
                        props.onChange(
                          on() ? chosen().filter((item) => item !== option) : [...chosen(), option],
                        );
                    }}
                  >
                    {option}
                  </button>
                );
              }}
            </For>
          </fieldset>
        </Match>
        <Match when={props.field.type === 'time'}>
          <UiTimeField
            label={props.field.label}
            hideLabel
            class="diary-care-time"
            value={text()}
            onChange={props.onChange}
          />
        </Match>
        <Match when={props.field.type === 'date'}>
          <DateField label={props.field.label} hideLabel value={text()} onChange={props.onChange} />
        </Match>
      </Switch>
    </div>
  );
}

/**
 * The patient fills one assigned worksheet (CBT1): the memo — why and what to do — on top, the
 * explanation one tap away, then each column as a control with its «?», a microphone beside each
 * text, and the patient's own note. A material shows its text first, the practice log below.
 */
export function WorksheetSheet(props: {
  readonly assignment: DiaryAssignment;
  readonly day: string;
  readonly entry: DiaryEntry | undefined;
  /** Everything filled for this assignment, for the printed sheet. */
  readonly entries: readonly DiaryEntry[];
  readonly onSave: CareSave;
  readonly onRemove: (entry: DiaryEntry) => void;
  readonly onClose: () => void;
}): JSX.Element {
  const worksheet = () => props.assignment.worksheet;
  const fields = () => activeWorksheetFields(worksheet());
  const [cells, setCells] = createSignal<Cells>({ ...(props.entry?.sheet ?? {}) });
  const [note, setNote] = createSignal(props.entry?.note ?? '');
  const [time, setTime] = createSignal(
    props.entry ? clock(props.entry.at) : initialTime(props.day, props.assignment.time),
  );
  const [error, setError] = createSignal('');
  const [howOpen, setHowOpen] = createSignal(!props.entry && props.entries.length === 0);
  const spoken = createSpokenTracker(props.entry?.spoken);

  const set = (id: string, value: unknown): void => {
    setError('');
    setCells({ ...cells(), [id]: value });
  };

  const save = (): void => {
    const problem = worksheetSheetProblem(worksheet(), cells(), note());
    if (problem) {
      setError(problem);
      return;
    }
    const sheet = cleanSheet(worksheet(), cells());
    const marks = spoken.marks({ ...sheet, '#note': note() });
    setError(
      props.onSave({
        id: props.entry?.id ?? createDiaryId(),
        at: atTime(props.day, time()),
        values: {},
        assignment: props.assignment.id,
        ...(Object.keys(sheet).length ? { sheet } : {}),
        ...(note().trim() ? { note: note() } : {}),
        ...(marks ? { spoken: marks } : {}),
      }) ?? '',
    );
  };

  const print = (): void => {
    const html = worksheetPrintHtml(worksheet(), assignmentPrintRows(props.entries), {
      what: assignmentWhat(props.assignment),
    });
    if (!PrintManager.html(html, worksheet().title)) {
      setError('Телефон не открыл печать. Разрешите всплывающие окна.');
    }
  };

  return (
    <DiarySheet
      title={worksheet().title}
      subtitle={assignmentWhat(props.assignment)}
      tall
      onClose={props.onClose}
      footer={
        <SheetFooter
          error={error()}
          onSave={save}
          onRemove={props.entry ? () => props.entry && props.onRemove(props.entry) : undefined}
        />
      }
    >
      <section class="worksheet-fill__memo" aria-label="Памятка">
        <Show when={props.assignment.why}>
          <p class="worksheet-fill__memo-line">
            <strong class="worksheet-fill__memo-title">{PATIENT_MEMO.whyTitle}.</strong>{' '}
            {props.assignment.why}
          </p>
        </Show>
        <div class="worksheet-fill__memo-tools">
          <button
            type="button"
            class="worksheet-fill__how"
            aria-expanded={howOpen()}
            onClick={() => setHowOpen(!howOpen())}
          >
            Как заполнять
          </button>
          <button
            type="button"
            class="worksheet-fill__print"
            aria-label="Распечатать лист"
            onClick={print}
          >
            Печать
          </button>
        </div>
        <For
          each={worksheetPatientCare(worksheet())
            .split(/\n{2,}/u)
            .filter(Boolean)}
        >
          {(line) => <p class="worksheet-fill__memo-line worksheet-fill__care">{line}</p>}
        </For>
        <Show when={!seenNote()}>
          <p class="worksheet-fill__memo-line worksheet-fill__privacy">
            Микрофон у каждого поля: запись остаётся на телефоне, врачу уйдёт только текст.
          </p>
        </Show>
        <Show when={howOpen()}>
          <div class="worksheet-fill__how-text">
            <For
              each={worksheetPatientNote(worksheet())
                .split(/\n{2,}/u)
                .filter(Boolean)}
            >
              {(paragraph) => <p class="worksheet-fill__paragraph">{paragraph}</p>}
            </For>
            <p class="worksheet-fill__paragraph worksheet-fill__paragraph--quiet">
              {PATIENT_MEMO.notDone}
            </p>
          </div>
        </Show>
      </section>

      <Show when={worksheet().layout === 'material' || worksheet().sections.length > 0}>
        <details class="worksheet-fill__material" open={worksheet().layout === 'material'}>
          <summary class="worksheet-fill__material-summary">
            {worksheet().layout === 'material' ? 'Текст' : 'Правила'}
          </summary>
          <For each={worksheet().sections}>
            {(section) => (
              <section class="worksheet-fill__section">
                <h3 class="worksheet-fill__section-title">{section.title}</h3>
                <For each={section.text.split(/\n{2,}/u).filter(Boolean)}>
                  {(paragraph) => <p class="worksheet-fill__paragraph">{paragraph}</p>}
                </For>
              </section>
            )}
          </For>
        </details>
      </Show>

      <LocalVoiceClips spoken={props.entry?.spoken} />
      <TimeField value={time()} onInput={setTime} />
      <For each={fields()}>
        {(field) => (
          <FieldInput
            field={field}
            value={cells()[field.id]}
            onChange={(value) => set(field.id, value)}
            onSpoken={(said, origin) => spoken.add(field.id, said, origin)}
          />
        )}
      </For>
      <div class="worksheet-fill__with-voice">
        <GrowingText
          label="Что ещё важно"
          value={note()}
          placeholder="Что ещё хотите сказать врачу"
          onInput={setNote}
        />
        <VoiceNote
          compact="что ещё важно"
          onText={(said, origin) => {
            spoken.add('#note', said, origin);
            setNote(note().trim() ? `${note().trim()}\n${said}` : said);
          }}
        />
      </div>
    </DiarySheet>
  );
}
