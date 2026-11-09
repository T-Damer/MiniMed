import { createMemo, createResource, createSignal, For, Index, type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { DateField } from '@/components/DateField';
import { SkeletonLines } from '@/components/SkeletonLines';
import { Switch } from '@/components/Switch';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import { TimeField } from '@/components/TimeField';
import {
  ASSIGNMENT_WEEKDAY_SHORT,
  assignmentScheduleWords,
} from '@/features/diary/diary-assignments';
import type { CareAssignmentDraft } from '@/features/diary/diary-care-draft';
import type { DiaryAssignmentRepeat } from '@/features/diary/diary-model';
import { PrintManager } from '@/features/printing/print-manager';
import { ASSIGNMENT_CHECKLIST } from '@/features/worksheets/assignment-memo';
import { loadBuiltInWorksheets } from '@/features/worksheets/built-in-worksheets';
import { WorksheetFieldCard } from '@/features/worksheets/WorksheetEditor';
import { WORKSHEET_GROUP_GLYPH } from '@/features/worksheets/WorksheetsCatalog';
import { addWorksheetField, canAddWorksheetField } from '@/features/worksheets/worksheet-edit';
import { worksheetPrintHtml } from '@/features/worksheets/worksheet-print';
import { pluralRu } from '@/i18n/labels';
import {
  parseUserWorksheet,
  type UserWorksheet,
  WORKSHEET_GROUP_LABEL,
  WORKSHEET_GROUPS,
  worksheetHasExtendedFields,
} from '@/state/user-worksheet-format';
import { listUserWorksheets, saveWorksheetCopy } from '@/state/user-worksheets';

import '@/features/worksheets/worksheets.css';

/** The schedule of an assignment in the editor, as the patient will read it. */
export function draftScheduleWords(assignment: CareAssignmentDraft): string {
  return assignmentScheduleWords({
    repeat: assignment.repeat,
    days: assignment.days,
    time: assignment.time || undefined,
    until: assignment.until || undefined,
  });
}

const REPEAT_LABEL: Readonly<Record<DiaryAssignmentRepeat, string>> = {
  event: 'Когда случится',
  daily: 'Каждый день',
  days: 'По дням',
};

/**
 * «+ Задание» in the patient's screen editor (CBT1): the doctor's library — own versions first,
 * then the built-in sheets by section — with a search. A pick is copied into the patient's plan.
 */
export function WorksheetPicker(props: {
  readonly onPick: (worksheet: UserWorksheet) => void;
}): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [sheets] = createResource(async () => {
    const [builtIns, own] = await Promise.all([loadBuiltInWorksheets(), listUserWorksheets()]);
    return { builtIns, own: own.map((stored) => stored.worksheet) };
  });
  const matches = (worksheet: UserWorksheet): boolean => {
    const words = query().trim().toLocaleLowerCase('ru');
    return (
      !words || `${worksheet.title} ${worksheet.summary}`.toLocaleLowerCase('ru').includes(words)
    );
  };
  const groups = createMemo(() => {
    const loaded = sheets();
    if (!loaded) return [];
    const own = loaded.own.filter(matches);
    return [
      ...(own.length ? [{ title: 'Мои версии', sheets: own }] : []),
      ...WORKSHEET_GROUPS.map((group) => ({
        title: WORKSHEET_GROUP_LABEL[group],
        sheets: loaded.builtIns.filter((sheet) => sheet.group === group && matches(sheet)),
      })).filter((group) => group.sheets.length),
    ];
  });
  return (
    <div class="screen-editor__sheet worksheet-picker">
      <TextField
        label="Найти лист"
        hideLabel
        placeholder="Запись мыслей, экспозиция, сон…"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
      />
      <Show when={!sheets.loading} fallback={<SkeletonLines label="Загружаем листы" lines={5} />}>
        <Show when={sheets.error}>
          <p class="worksheet-picker__error" role="alert">
            Библиотека не открылась. Закройте окно и попробуйте ещё раз.
          </p>
        </Show>
        <For each={groups()}>
          {(group) => (
            <section class="worksheet-picker__group" aria-label={group.title}>
              <h3 class="worksheet-picker__title">{group.title}</h3>
              <ul class="worksheet-picker__list">
                <For each={group.sheets}>
                  {(sheet) => (
                    <li class="worksheet-picker__item">
                      <button
                        type="button"
                        class="worksheet-picker__row"
                        onClick={() => props.onPick(sheet)}
                      >
                        <AppGlyph
                          name={WORKSHEET_GROUP_GLYPH[sheet.group]}
                          class="worksheet-picker__glyph"
                        />
                        <span class="worksheet-picker__copy">
                          <span class="worksheet-picker__name">{sheet.title}</span>
                          <Show when={sheet.summary}>
                            <span class="worksheet-picker__summary">{sheet.summary}</span>
                          </Show>
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          )}
        </For>
        <Show when={!sheets.error && groups().length === 0}>
          <p class="worksheet-picker__empty">Ничего не нашлось.</p>
        </Show>
      </Show>
    </div>
  );
}

function fieldCount(count: number): string {
  return `${count} ${pluralRu(count, 'поле', 'поля', 'полей')}`;
}

/**
 * One assignment for this patient (CBT1), as a sheet over the live preview: the version and
 * variant, when to fill it, the patient's memo, the sheet's columns for this patient, the doctor's
 * checklist, and «Сохранить в библиотеку» for a version worth keeping.
 */
export function AssignmentEditor(props: {
  readonly assignment: CareAssignmentDraft;
  readonly onChange: (next: CareAssignmentDraft) => void;
  readonly onRemove: () => void;
  readonly onDone: () => void;
}): JSX.Element {
  const [fieldsOpen, setFieldsOpen] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const worksheet = (): UserWorksheet => props.assignment.worksheet;
  const patch = (next: Partial<CareAssignmentDraft>): void =>
    props.onChange({ ...props.assignment, ...next });
  const changeSheet = (edit: (sheet: UserWorksheet) => UserWorksheet): void =>
    patch({ worksheet: { ...edit(worksheet()), updatedAt: new Date().toISOString() } });
  /** The sheet as it stands is valid for the plan; otherwise why not. */
  const problem = createMemo(() => {
    try {
      parseUserWorksheet(worksheet());
      return '';
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Лист некорректен.';
    }
  });
  const schedule = (): string => draftScheduleWords(props.assignment);

  const toggleDay = (day: number): void => {
    const days = props.assignment.days.includes(day)
      ? props.assignment.days.filter((one) => one !== day)
      : [...props.assignment.days, day].toSorted((left, right) => left - right);
    if (days.length) patch({ days });
  };

  const print = (): void => {
    if (problem()) return;
    const html = worksheetPrintHtml(worksheet(), [], {
      what: props.assignment.what.trim() || schedule(),
    });
    if (!PrintManager.html(html, worksheet().title)) {
      toast.error('Браузер не открыл окно печати. Разрешите всплывающие окна.');
    }
  };

  const keep = async (): Promise<void> => {
    if (problem()) return;
    setSaving(true);
    try {
      await saveWorksheetCopy(worksheet());
      toast.success('Сохранено в библиотеку', {
        description: '«Дневники и задания» → «Мои версии».',
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось сохранить.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div class="screen-editor__sheet assignment-editor">
      <Show when={worksheet().variants.length > 0}>
        <ChoiceGroup
          legend="Вариант"
          orientation="horizontal"
          options={worksheet().variants.map((variant) => ({
            value: variant.id,
            label: variant.label,
          }))}
          value={worksheet().variant ?? worksheet().variants[0]?.id ?? ''}
          onChange={(variant) => changeSheet((sheet) => ({ ...sheet, variant }))}
        />
      </Show>
      <Show when={worksheetHasExtendedFields(worksheet())}>
        <div class="assignment-editor__switch-row">
          <span class="assignment-editor__switch-label">
            Расширенная версия · {fieldCount(worksheet().fields.length)}
          </span>
          <Switch
            aria-label="Расширенная версия"
            checked={worksheet().extended}
            onChange={(extended) => changeSheet((sheet) => ({ ...sheet, extended }))}
          />
        </div>
      </Show>

      <ChoiceGroup
        legend="Как часто"
        orientation="horizontal"
        options={(['event', 'daily', 'days'] as const).map((repeat) => ({
          value: repeat,
          label: REPEAT_LABEL[repeat],
        }))}
        value={props.assignment.repeat}
        onChange={(repeat) => patch({ repeat: repeat as DiaryAssignmentRepeat })}
      />
      <Show when={props.assignment.repeat === 'days'}>
        <fieldset class="assignment-editor__days">
          <legend class="visually-hidden">Дни недели</legend>
          <For each={ASSIGNMENT_WEEKDAY_SHORT}>
            {(label, index) => (
              <button
                type="button"
                class="assignment-editor__day"
                classList={{
                  'assignment-editor__day--on': props.assignment.days.includes(index() + 1),
                }}
                aria-pressed={props.assignment.days.includes(index() + 1)}
                onClick={() => toggleDay(index() + 1)}
              >
                {label}
              </button>
            )}
          </For>
        </fieldset>
      </Show>
      <div class="assignment-editor__when">
        <Show when={props.assignment.repeat !== 'event'}>
          <TimeField
            label="Напомнить в"
            value={props.assignment.time}
            onChange={(time) => patch({ time })}
          />
        </Show>
        <DateField
          label="До какого дня"
          value={props.assignment.until}
          min={props.assignment.from}
          onChange={(until) => patch({ until })}
        />
      </div>

      <TextArea
        label="Зачем это вам — для пациента"
        rows={2}
        placeholder="Что это даст пациенту — его словами"
        value={props.assignment.why}
        onInput={(event) => patch({ why: event.currentTarget.value })}
      />
      <TextArea
        label="Что и когда делать"
        rows={2}
        placeholder={schedule()}
        value={props.assignment.what}
        onInput={(event) => patch({ what: event.currentTarget.value })}
      />

      <details class="assignment-editor__checklist">
        <summary class="assignment-editor__summary">Как дать задание</summary>
        <ul class="assignment-editor__checks">
          <For each={ASSIGNMENT_CHECKLIST}>
            {(check) => <li class="assignment-editor__check">{check.text}</li>}
          </For>
        </ul>
      </details>

      <details
        class="assignment-editor__fields"
        open={fieldsOpen()}
        onToggle={(event) => setFieldsOpen(event.currentTarget.open)}
      >
        <summary class="assignment-editor__summary">Поля и пояснения для этого пациента</summary>
        <Show when={fieldsOpen()}>
          <TextArea
            label="Для пациента: зачем это и как заполнять"
            rows={4}
            value={worksheet().patientNote}
            onInput={(event) => {
              const patientNote = event.currentTarget.value;
              changeSheet((sheet) => ({ ...sheet, patientNote }));
            }}
          />
          <ol class="worksheet-editor__list">
            <Index each={worksheet().fields}>
              {(field, index) => (
                <WorksheetFieldCard
                  field={field()}
                  index={index}
                  count={worksheet().fields.length}
                  onChange={changeSheet}
                />
              )}
            </Index>
          </ol>
          <Button
            type="button"
            class="worksheet-editor__add"
            disabled={!canAddWorksheetField(worksheet())}
            icon={<AppGlyph name="plus" class="worksheet-editor__icon-glyph" />}
            onClick={() => changeSheet(addWorksheetField)}
          >
            Поле
          </Button>
        </Show>
      </details>

      <Show when={problem()}>
        <p class="assignment-editor__problem" role="alert">
          {problem()}
        </p>
      </Show>

      <div class="assignment-editor__tools">
        <Button
          type="button"
          variant="icon"
          aria-label="Распечатать бланк"
          disabled={Boolean(problem())}
          icon={<AppGlyph name="printer" class="screen-editor__glyph" />}
          onClick={print}
        />
        <Button
          type="button"
          disabled={saving() || Boolean(problem())}
          icon={<AppGlyph name="books" class="screen-editor__glyph" />}
          onClick={() => void keep()}
        >
          В библиотеку
        </Button>
      </div>
      <div class="screen-editor__sheet-actions">
        <Button
          type="button"
          variant="icon"
          class="screen-editor__remove"
          aria-label="Убрать задание"
          icon={<AppGlyph name="trash" class="screen-editor__glyph" />}
          onClick={() => props.onRemove()}
        />
        <Button type="button" variant="primary" onClick={() => props.onDone()}>
          Готово
        </Button>
      </div>
    </div>
  );
}
