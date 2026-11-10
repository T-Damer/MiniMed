import {
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
  lazy,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ChoiceChip } from '@/components/ChoiceChip';
import { DateRangeCalendar } from '@/components/DateRangeCalendar';
import { countDays, describeRanges } from '@/components/date-ranges';
import { OverlayDialog } from '@/components/OverlayDialog';
import { PillMark } from '@/components/PillMark';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SelectField } from '@/components/SelectField';
import { Switch } from '@/components/Switch';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import { TimeField } from '@/components/TimeField';
import { DiaryHeatmap, heatmapRange } from '@/diary/DiaryHeatmap';
import { CareRow } from '@/diary/DiaryToday';
import { QuestionnaireSheet } from '@/diary/QuestionnaireSheet';
import { assignmentScheduleWords } from '@/features/diary/diary-assignments';
import {
  addDays,
  DAY_PERIOD_LABEL,
  type DayPeriod,
  dayKey,
  dayPeriod,
  type HeatDay,
} from '@/features/diary/diary-care';
import {
  CARE_SECTION_LABEL,
  type CareAppointmentDraft,
  type CareAssignmentDraft,
  type CareContactDraft,
  type CareDoseDraft,
  type CareDraft,
  type CareLabDraft,
  type CareSectionDraft,
  type CareSectionKind,
  copyCareSection,
  EMPTY_CARE_CONTACT,
  newCareAppointment,
  newCareAssignment,
  newCareLab,
  newCareSection,
  newCustomQuestionnaireSection,
} from '@/features/diary/diary-care-draft';
import { prescribingWarnings } from '@/features/diary/diary-med-history';
import {
  DIARY_MEAL_LABEL,
  type DiaryCheckpoint,
  type DiaryContactKind,
  type DiaryMeal,
  MAX_DIARY_APPOINTMENTS,
  MAX_DIARY_ASSIGNMENTS,
  MAX_DIARY_CONTACTS,
  MAX_DIARY_DOSE_TIMES,
  MAX_DIARY_LABS,
  MAX_DIARY_OPTIONS,
  MAX_DIARY_PLAN_ITEMS,
} from '@/features/diary/diary-model';
import {
  listOwnQuestionnaires,
  loadOwnQuestionnaire,
  OWN_QUESTIONNAIRE_NEW_HASH,
} from '@/features/diary/diary-own-questionnaires';
import {
  DIARY_QUESTIONNAIRES,
  diaryQuestionnaire,
  questionnaireCheckpointId,
} from '@/features/diary/diary-questionnaires';
import { studyAtcCodes } from '@/features/diary/diary-research';
import { SUBSTANCES, substanceById } from '@/features/diary/diary-substances';
import { appointmentWhen, dayWords } from '@/features/diary/diary-visits';
import { PastMedWarnings } from '@/features/diary/med-history/MedHistory';
import { useMedHistory } from '@/features/diary/med-history/plan-removals';
import { AppointmentEditor, LabEditor } from '@/features/diary/VisitEditors';
import type { UserWorksheet } from '@/state/user-worksheet-format';

// The library and the per-patient sheet editor load when the doctor first adds a task (CBT1).
const AssignmentEditor = lazy(() =>
  import('@/features/diary/AssignmentEditor').then((module) => ({
    default: module.AssignmentEditor,
  })),
);
const WorksheetPicker = lazy(() =>
  import('@/features/diary/AssignmentEditor').then((module) => ({
    default: module.WorksheetPicker,
  })),
);

import { DrugSearchField } from '@/features/drug-picker/DrugSearchField';
import type { DrugSuggestionForm } from '@/features/drug-picker/drug-suggest';
import {
  durationPhrase,
  frequencyPhrase,
  routeOfForm,
} from '@/features/prescription/prescription-text';
import { pieceWords } from '@/features/prescription/product-strength';
import { visitRoute } from '@/state/app-back';
import '@/features/diary/patient-screen-editor.css';

const KIND_ICON: Readonly<Record<CareSectionKind, AppGlyphName>> = {
  drug: 'pill',
  score: 'smiley',
  mood: 'brain',
  vitals: 'heartbeat',
  body: 'scales',
  glucose: 'drop-half',
  activity: 'sneaker-move',
  meals: 'fork-knife',
  text: 'note-pencil',
  choice: 'list-checks',
  use: 'drop',
  questionnaire: 'list-numbers',
};

const KIND_ORDER: readonly CareSectionKind[] = [
  'drug',
  'score',
  'mood',
  'vitals',
  'body',
  'glucose',
  'activity',
  'meals',
  'text',
  'choice',
  'use',
  'questionnaire',
];

/** The groups of the patient's day screen, in its order. */
const GROUPS: readonly { readonly title: string; readonly kinds: readonly CareSectionKind[] }[] = [
  { title: 'Лекарства', kinds: ['drug'] },
  {
    title: 'Самочувствие и показатели',
    kinds: [
      'score',
      'mood',
      'vitals',
      'body',
      'glucose',
      'activity',
      'meals',
      'text',
      'choice',
      'use',
    ],
  },
  { title: 'Опросники', kinds: ['questionnaire'] },
];

const MEAL_OPTIONS: readonly { readonly value: DiaryMeal | 'any'; readonly label: string }[] = [
  { value: 'any', label: 'Любое' },
  { value: 'before', label: 'До еды' },
  { value: 'with', label: 'С едой' },
  { value: 'after', label: 'После' },
];

const PERIOD_OPTIONS = [
  { value: '7', label: 'Неделя' },
  { value: '14', label: '2 недели' },
  { value: '30', label: 'Месяц' },
] as const;

const CONTACT_KINDS: readonly { readonly value: DiaryContactKind; readonly label: string }[] = [
  { value: 'phone', label: 'Телефон' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'email', label: 'Почта' },
  { value: 'link', label: 'Ссылка' },
];

const CONTACT_PLACEHOLDER: Readonly<Record<DiaryContactKind, string>> = {
  phone: '+7 900 000-00-00',
  telegram: '@имя',
  email: 'doctor@clinic.ru',
  link: 'https://…',
};

function timesText(times: readonly CareDoseDraft[]): string {
  return times
    .filter((time) => time.time)
    .map((time) => (time.meal ? `${time.time} ${DIARY_MEAL_LABEL[time.meal]}` : time.time))
    .join(', ');
}

/** What the patient's row says under the title. */
function sectionDetail(section: CareSectionDraft): string {
  switch (section.kind) {
    case 'drug':
      return [
        [section.dose, section.form].filter((part) => part.trim()).join(' · '),
        section.asNeeded || !section.times.length ? 'при необходимости' : timesText(section.times),
        section.course.length ? describeRanges(section.course) : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'choice':
      return section.options.filter((option) => option.trim()).join(' / ');
    case 'use':
      return [
        section.substances.flatMap((id) => substanceById(id)?.short ?? []).join(', '),
        section.craving ? 'тяга' : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'questionnaire':
      return `${diaryQuestionnaire(section.quiz)?.about ?? 'свой опросник'} · раз в ${section.everyDays} дн.`;
    default:
      // The row shows the first time; the detail adds the others, or says it has none.
      return section.times.filter((time) => time.time).length > 1
        ? timesText(section.times)
        : section.times.some((time) => time.time)
          ? ''
          : 'в любое время дня';
  }
}

/**
 * The signa in the prescription tool's own wording: «Внутрь по 1 таблетке 2 раза в день (08:00
 * после еды, 20:00) в течение 14 дней.»
 */
function suggestedSigna(section: CareSectionDraft): string {
  const form = section.form.trim();
  const piece = form ? pieceWords(form) : null;
  const parts = [
    routeOfForm(form) ?? (piece ? 'Внутрь' : ''),
    piece ? `по 1 ${piece.dative}` : section.dose.trim() ? `по ${section.dose.trim()}` : '',
  ];
  const times = section.times.filter((time) => time.time);
  if (section.asNeeded || !times.length) parts.push('при необходимости');
  else parts.push(`${frequencyPhrase(times.length, 1)} (${timesText(times)})`);
  if (section.course.length === 1) parts.push(durationPhrase(countDays(section.course)));
  const text = parts.filter(Boolean).join(' ');
  return `${text.charAt(0).toLocaleUpperCase('ru-RU')}${text.slice(1)}.`;
}

/** A line of the preview the doctor taps to write it; shows a «+» placeholder while empty. */
function EditableLine(props: {
  readonly value: string;
  readonly placeholder: string;
  readonly label: string;
  readonly class: string;
  readonly multiline?: boolean;
  readonly onInput: (value: string) => void;
}): JSX.Element {
  const [editing, setEditing] = createSignal(false);
  return (
    <Show
      when={editing()}
      fallback={
        <button
          type="button"
          class={`screen-editor__editable care-editable ${props.class}`}
          classList={{ 'care-editable--empty': !props.value.trim() }}
          onClick={() => setEditing(true)}
        >
          <Show when={!props.value.trim()}>
            <AppGlyph name="plus" class="screen-editor__editable-glyph" />
          </Show>
          <span class="screen-editor__editable-text">
            {props.value.trim() || props.placeholder}
          </span>
          <Show when={props.value.trim()}>
            <AppGlyph name="edit" class="screen-editor__editable-glyph" />
          </Show>
        </button>
      }
    >
      <Show
        when={props.multiline}
        fallback={
          <TextField
            inputClass="screen-editor__input"
            label={props.label}
            hideLabel
            placeholder={props.placeholder}
            autofocus
            value={props.value}
            onInput={(event) => props.onInput(event.currentTarget.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setEditing(false);
            }}
          />
        }
      >
        <TextArea
          textareaClass="screen-editor__input"
          label={props.label}
          hideLabel
          maxLength={200}
          placeholder={props.placeholder}
          autofocus
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          onBlur={() => setEditing(false)}
        />
      </Show>
    </Show>
  );
}

/** Intake or fill times; a medicine also says how it relates to food. */
function TimesEditor(props: {
  readonly times: readonly CareDoseDraft[];
  readonly meals: boolean;
  readonly emptyText: string;
  readonly onChange: (times: CareDoseDraft[]) => void;
}): JSX.Element {
  const patch = (index: number, next: Partial<CareDoseDraft>): void =>
    props.onChange(
      props.times.map((time, position) => (position === index ? { ...time, ...next } : time)),
    );
  return (
    <div class="screen-editor__times">
      <Show when={!props.times.length}>
        <p class="screen-editor__muted">{props.emptyText}</p>
      </Show>
      <Index each={props.times}>
        {(time, index) => (
          <div class="screen-editor__time">
            <TimeField
              label="Время"
              hideLabel
              class="screen-editor__time-field"
              value={time().time}
              onChange={(value) => patch(index, { time: value })}
            />
            <span class="screen-editor__leader" aria-hidden="true" />
            <Show when={props.meals}>
              <SegmentedControl
                label="Еда"
                class="screen-editor__meal"
                stretch
                value={time().meal ?? 'any'}
                options={MEAL_OPTIONS}
                onChange={(value) => patch(index, { meal: value === 'any' ? undefined : value })}
              />
            </Show>
            <Button
              type="button"
              variant="icon"
              aria-label={`Убрать время ${time().time}`}
              icon={<AppGlyph name="close" class="screen-editor__glyph" />}
              onClick={() =>
                props.onChange(props.times.filter((_, position) => position !== index))
              }
            />
          </div>
        )}
      </Index>
      <Button
        type="button"
        variant="secondary"
        class="screen-editor__wide"
        icon={<AppGlyph name="clock" class="screen-editor__glyph" />}
        disabled={props.times.length >= MAX_DIARY_DOSE_TIMES}
        onClick={() => {
          const last = props.times.at(-1)?.time;
          const hour = last ? Math.min(23, Number(last.slice(0, 2)) + 4) : 9;
          props.onChange([
            ...props.times,
            { time: `${String(hour).padStart(2, '0')}:00`, meal: undefined },
          ]);
        }}
      >
        Добавить время
      </Button>
    </div>
  );
}

/**
 * A medicine: the name first; form, dose, times, signa and the course follow once a medicine is
 * chosen from the list, or a name of the doctor's own is typed and left (owner 2026-11-04: a short
 * sheet, no suggestions under an empty name).
 */
function DrugFields(props: {
  readonly section: CareSectionDraft;
  readonly patch: (next: Partial<CareSectionDraft>) => void;
  readonly chosen: boolean;
  readonly onChosen: () => void;
}): JSX.Element {
  const [forms, setForms] = createSignal<readonly DrugSuggestionForm[]>([]);
  const [calendar, setCalendar] = createSignal(false);
  // MEDHIST1: the history's reactions to this medicine or its ATC group, as a note, never a block.
  const history = useMedHistory();
  const [picked, setPicked] = createSignal<
    { readonly slug: string; readonly atc: readonly string[] } | undefined
  >(props.section.drug ? { slug: props.section.drug, atc: props.section.atc ?? [] } : undefined);
  const warnings = createMemo(() =>
    prescribingWarnings(history(), { name: props.section.title, ...picked() }),
  );
  const strengths = (): readonly string[] =>
    forms().find((form) => form.form === props.section.form)?.strengths ?? [];
  return (
    <>
      <div
        class="screen-editor__drug-name"
        onFocusOut={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          if (props.section.title.trim()) props.onChosen();
        }}
      >
        <DrugSearchField
          label="Препарат"
          placeholder="Начните вводить название"
          value={props.section.title}
          onInput={(title) => {
            setPicked(undefined);
            props.patch({ title, drug: undefined, atc: undefined });
          }}
          onPick={(picked) => {
            setPicked({ slug: picked.slug, atc: picked.atc });
            setForms(picked.forms);
            const first = picked.forms[0];
            const atc = studyAtcCodes(picked.atc);
            props.patch({
              drug: picked.slug,
              atc: atc.length ? atc : undefined,
              title: picked.product ?? picked.name,
              form: first?.form ?? props.section.form,
              dose: first?.strengths[0] ?? props.section.dose,
            });
            props.onChosen();
          }}
        />
      </div>
      <PastMedWarnings warnings={warnings()} />
      <Show when={props.chosen}>
        <div class="screen-editor__reveal">
          <div class="screen-editor__pair">
            <TextField
              inputClass="screen-editor__input"
              label="Форма"
              placeholder="таблетки"
              value={props.section.form}
              onInput={(event) => props.patch({ form: event.currentTarget.value })}
            />
            <TextField
              inputClass="screen-editor__input"
              label="Доза"
              placeholder="50 мг"
              value={props.section.dose}
              onInput={(event) => props.patch({ dose: event.currentTarget.value })}
            />
          </div>
          <TextField
            inputClass="screen-editor__input"
            label="Мишень — на что назначено"
            placeholder="например, сон или давление"
            maxLength={120}
            value={props.section.target ?? ''}
            onInput={(event) => props.patch({ target: event.currentTarget.value })}
          />
          <Show when={forms().length > 1 || strengths().length > 1}>
            <div class="screen-editor__chips">
              <For each={forms().length > 1 ? forms() : []}>
                {(form) => (
                  <ChoiceChip
                    compact
                    accent={props.section.form === form.form}
                    aria-pressed={props.section.form === form.form}
                    onClick={() =>
                      props.patch({
                        form: form.form,
                        dose: form.strengths[0] ?? props.section.dose,
                      })
                    }
                  >
                    {form.form}
                  </ChoiceChip>
                )}
              </For>
              <For each={strengths().length > 1 ? strengths() : []}>
                {(strength) => (
                  <ChoiceChip
                    compact
                    accent={props.section.dose === strength}
                    aria-pressed={props.section.dose === strength}
                    onClick={() => props.patch({ dose: strength })}
                  >
                    {strength}
                  </ChoiceChip>
                )}
              </For>
            </div>
          </Show>
          <div class="screen-editor__switch">
            <Switch
              aria-label="При необходимости"
              checked={props.section.asNeeded}
              onChange={(asNeeded) => props.patch({ asNeeded })}
            />
            <span class="screen-editor__switch-text">При необходимости</span>
          </div>
          <Show when={!props.section.asNeeded}>
            <TimesEditor
              times={props.section.times}
              meals
              emptyText="Без времени — пациент отметит приём сам"
              onChange={(times) => props.patch({ times })}
            />
          </Show>
          <TextArea
            textareaClass="screen-editor__input"
            label="Signa — как принимать"
            maxLength={300}
            placeholder={suggestedSigna(props.section)}
            value={props.section.signa}
            onInput={(event) => props.patch({ signa: event.currentTarget.value })}
          />
          <Show when={!props.section.signa.trim()}>
            <div class="screen-editor__chips">
              <ChoiceChip
                compact
                onClick={() => props.patch({ signa: suggestedSigna(props.section) })}
              >
                {suggestedSigna(props.section)}
              </ChoiceChip>
            </div>
          </Show>
          <button
            type="button"
            class="screen-editor__course"
            aria-expanded={calendar()}
            onClick={() => setCalendar(!calendar())}
          >
            <AppGlyph name="calendar" class="screen-editor__glyph" />
            <span class="screen-editor__course-text">{describeRanges(props.section.course)}</span>
            <AppGlyph name={calendar() ? 'caret-up' : 'caret-down'} class="screen-editor__glyph" />
          </button>
          <Show when={calendar()}>
            <DateRangeCalendar
              value={props.section.course}
              onChange={(course) => props.patch({ course })}
            />
          </Show>
        </div>
      </Show>
    </>
  );
}

function ChoiceFields(props: {
  readonly section: CareSectionDraft;
  readonly patch: (next: Partial<CareSectionDraft>) => void;
}): JSX.Element {
  const setOption = (index: number, value: string): void =>
    props.patch({
      options: props.section.options.map((option, position) =>
        position === index ? value : option,
      ),
    });
  return (
    <div class="screen-editor__options">
      <Index each={props.section.options}>
        {(option, index) => (
          <div class="screen-editor__option">
            <TextField
              inputClass="screen-editor__input"
              label={`Вариант ${index + 1}`}
              hideLabel
              placeholder={`Вариант ${index + 1}`}
              value={option()}
              onInput={(event) => setOption(index, event.currentTarget.value)}
            />
            <Button
              type="button"
              variant="icon"
              aria-label={`Убрать вариант ${index + 1}`}
              icon={<AppGlyph name="close" class="screen-editor__glyph" />}
              disabled={props.section.options.length <= 2}
              onClick={() =>
                props.patch({
                  options: props.section.options.filter((_, position) => position !== index),
                })
              }
            />
          </div>
        )}
      </Index>
      <Button
        type="button"
        variant="secondary"
        class="screen-editor__wide"
        icon={<AppGlyph name="plus" class="screen-editor__glyph" />}
        disabled={props.section.options.length >= MAX_DIARY_OPTIONS}
        onClick={() => props.patch({ options: [...props.section.options, ''] })}
      >
        Добавить вариант
      </Button>
    </div>
  );
}

/** Which substances the patient marks, and whether the craving is asked too. */
function UseFields(props: {
  readonly section: CareSectionDraft;
  readonly patch: (next: Partial<CareSectionDraft>) => void;
}): JSX.Element {
  const toggle = (id: string): void =>
    props.patch({
      substances: props.section.substances.includes(id)
        ? props.section.substances.filter((chosen) => chosen !== id)
        : [...props.section.substances, id],
    });
  return (
    <>
      <fieldset class="screen-editor__chips screen-editor__chips--set">
        <legend class="visually-hidden">Что отмечает пациент</legend>
        <For each={SUBSTANCES}>
          {(substance) => (
            <ChoiceChip
              accent={props.section.substances.includes(substance.id)}
              aria-pressed={props.section.substances.includes(substance.id)}
              onClick={() => toggle(substance.id)}
            >
              {substance.label}
            </ChoiceChip>
          )}
        </For>
      </fieldset>
      <div class="screen-editor__switch">
        <Switch
          aria-label="Спрашивать про тягу"
          checked={props.section.craving}
          onChange={(craving) => props.patch({ craving })}
        />
        <span class="screen-editor__switch-text">Спрашивать про тягу</span>
      </div>
    </>
  );
}

/** The editor that opens in place of a row of the preview. */
function SectionEditor(props: {
  readonly section: CareSectionDraft;
  /** A copy of another medicine's schedule: its fields show before a medicine is chosen. */
  readonly copied: boolean;
  readonly taken: ReadonlySet<string>;
  readonly onChange: (section: CareSectionDraft) => void;
  readonly onRemove: () => void;
  readonly onDone: () => void;
  /** Opens the chosen questionnaire as the patient will see it (owner 2026-11-04). */
  readonly onPreview: () => void;
  /** The same schedule for another medicine. */
  readonly onCopy: () => void;
}): JSX.Element {
  const patch = (next: Partial<CareSectionDraft>): void =>
    props.onChange({ ...props.section, ...next });
  const [chosen, setChosen] = createSignal(
    props.section.kind !== 'drug' || Boolean(props.section.title.trim()) || props.copied,
  );
  // The doctor's own questionnaires from the main app's builder, read when a questionnaire opens.
  // A plain signal, not a resource: a resource read here suspended the whole page (a blink).
  const [own, setOwn] = createSignal<Awaited<ReturnType<typeof listOwnQuestionnaires>>>([]);
  const [ownError, setOwnError] = createSignal('');
  onMount(() => {
    if (props.section.kind !== 'questionnaire') return;
    listOwnQuestionnaires()
      .then(setOwn)
      .catch((cause: unknown) =>
        setOwnError(cause instanceof Error ? cause.message : 'Свои опросники не открылись.'),
      );
  });
  return (
    <div class="screen-editor__sheet">
      <Show when={props.section.kind === 'drug'}>
        <DrugFields
          section={props.section}
          patch={patch}
          chosen={chosen()}
          onChosen={() => setChosen(true)}
        />
      </Show>
      <Show when={props.section.kind === 'questionnaire'}>
        <fieldset class="screen-editor__chips screen-editor__chips--set">
          <legend class="visually-hidden">Опросник</legend>
          <For each={DIARY_QUESTIONNAIRES}>
            {(option) => (
              <ChoiceChip
                accent={props.section.quiz === option.slug}
                aria-pressed={props.section.quiz === option.slug}
                disabled={props.section.quiz !== option.slug && props.taken.has(option.slug)}
                detail={option.about}
                onClick={() => {
                  const { custom: _own, ...rest } = props.section;
                  props.onChange({ ...rest, quiz: option.slug, title: option.title });
                }}
              >
                {option.title}
              </ChoiceChip>
            )}
          </For>
          <For each={own()}>
            {(option) => (
              <ChoiceChip
                accent={props.section.quiz === option.slug}
                aria-pressed={props.section.quiz === option.slug}
                disabled={
                  Boolean(option.problem) ||
                  (props.section.quiz !== option.slug && props.taken.has(option.slug))
                }
                detail={option.problem ?? `свой · ${option.questionCount} вопр.`}
                onClick={() => {
                  setOwnError('');
                  loadOwnQuestionnaire(option.id)
                    .then((questionnaire) =>
                      props.onChange({
                        ...newCustomQuestionnaireSection(questionnaire, option.id),
                        key: props.section.key,
                        everyDays: props.section.everyDays,
                        tip: props.section.tip,
                      }),
                    )
                    .catch((cause: unknown) =>
                      setOwnError(cause instanceof Error ? cause.message : 'Опросник не открылся.'),
                    );
                }}
              >
                {option.title}
              </ChoiceChip>
            )}
          </For>
          <ChoiceChip onClick={() => visitRoute(OWN_QUESTIONNAIRE_NEW_HASH)}>
            + Свой опросник
          </ChoiceChip>
        </fieldset>
        <Show when={ownError()}>
          <p class="screen-editor__muted" role="alert">
            {ownError()}
          </p>
        </Show>
        <Show when={props.section.quiz}>
          <Button
            type="button"
            variant="secondary"
            class="screen-editor__preview"
            icon={<AppGlyph name="eye" class="screen-editor__glyph" />}
            onClick={() => props.onPreview()}
          >
            Посмотреть вопросы
          </Button>
        </Show>
        <SegmentedControl
          label="Как часто"
          stretch
          value={String(props.section.everyDays) as '7' | '14' | '30'}
          options={PERIOD_OPTIONS}
          onChange={(value) => patch({ everyDays: Number(value) })}
        />
      </Show>
      <Show when={props.section.kind !== 'drug' && props.section.kind !== 'questionnaire'}>
        <TextField
          inputClass="screen-editor__input"
          label="Что видит пациент"
          value={props.section.title}
          onInput={(event) => patch({ title: event.currentTarget.value })}
        />
        <Show when={props.section.kind === 'choice'}>
          <ChoiceFields section={props.section} patch={patch} />
        </Show>
        <Show when={props.section.kind === 'use'}>
          <UseFields section={props.section} patch={patch} />
        </Show>
        <TimesEditor
          times={props.section.times}
          meals={false}
          emptyText="Раз в день, в любое время"
          onChange={(times) => patch({ times })}
        />
      </Show>
      <Show when={chosen()}>
        <TextField
          class="screen-editor__reveal"
          inputClass="screen-editor__input"
          label="Подсказка пациенту"
          placeholder="Пациент увидит «?» рядом с разделом"
          value={props.section.tip}
          onInput={(event) => patch({ tip: event.currentTarget.value })}
        />
      </Show>
      <div class="screen-editor__sheet-actions">
        <Button
          type="button"
          variant="icon"
          class="screen-editor__remove"
          aria-label={`Удалить раздел ${props.section.title || CARE_SECTION_LABEL[props.section.kind]}`}
          icon={<AppGlyph name="trash" class="screen-editor__glyph" />}
          onClick={() => props.onRemove()}
        />
        <Show when={props.section.kind === 'drug' && chosen()}>
          <Button
            type="button"
            variant="secondary"
            class="screen-editor__copy"
            title="То же расписание для другого препарата"
            aria-label="Копия для другого препарата"
            icon={<AppGlyph name="copy-simple" class="screen-editor__glyph" />}
            onClick={() => props.onCopy()}
          >
            Копия
          </Button>
        </Show>
        <Button type="button" variant="primary" onClick={() => props.onDone()}>
          Готово
        </Button>
      </div>
    </div>
  );
}

function ContactsEditor(props: {
  readonly draft: CareDraft;
  readonly patch: (next: Partial<CareDraft>) => void;
  readonly onDone: () => void;
}): JSX.Element {
  const patchContact = (index: number, next: Partial<CareContactDraft>): void =>
    props.patch({
      contacts: props.draft.contacts.map((contact, position) =>
        position === index ? { ...contact, ...next } : contact,
      ),
    });
  return (
    <div class="screen-editor__sheet">
      <Index each={props.draft.contacts}>
        {(contact, index) => (
          <div class="screen-editor__contact">
            <SelectField
              label="Вид"
              hideLabel
              value={contact().kind}
              options={CONTACT_KINDS}
              onChange={(event) =>
                patchContact(index, { kind: event.currentTarget.value as DiaryContactKind })
              }
            />
            <TextField
              inputClass="screen-editor__input"
              label="Контакт"
              hideLabel
              placeholder={CONTACT_PLACEHOLDER[contact().kind]}
              value={contact().value}
              onInput={(event) => patchContact(index, { value: event.currentTarget.value })}
            />
            <Button
              type="button"
              variant="icon"
              aria-label="Убрать контакт"
              icon={<AppGlyph name="trash" class="screen-editor__glyph" />}
              onClick={() =>
                props.patch({
                  contacts: props.draft.contacts.filter((_, position) => position !== index),
                })
              }
            />
            <TextField
              class="screen-editor__contact-label"
              inputClass="screen-editor__input"
              label="Подпись"
              hideLabel
              placeholder="Подпись: «Регистратура», «Лечащий врач»"
              value={contact().label}
              onInput={(event) => patchContact(index, { label: event.currentTarget.value })}
            />
          </div>
        )}
      </Index>
      <Button
        type="button"
        variant="secondary"
        class="screen-editor__wide"
        icon={<AppGlyph name="plus" class="screen-editor__glyph" />}
        disabled={props.draft.contacts.length >= MAX_DIARY_CONTACTS}
        onClick={() => props.patch({ contacts: [...props.draft.contacts, EMPTY_CARE_CONTACT] })}
      >
        Добавить контакт
      </Button>
      <TextArea
        textareaClass="screen-editor__input"
        label="Куда обратиться в кризис, по строке"
        placeholder="Телефон доверия клиники"
        value={props.draft.crisis}
        onInput={(event) => props.patch({ crisis: event.currentTarget.value })}
      />
      <div class="screen-editor__sheet-actions">
        <Button type="button" variant="primary" onClick={() => props.onDone()}>
          Готово
        </Button>
      </div>
    </div>
  );
}

type Preview = { readonly kind: 'quiz'; readonly key: string } | undefined;

/** The checkpoint a questionnaire section becomes, to show it as the patient will. */
function quizCheckpoint(section: CareSectionDraft): DiaryCheckpoint {
  return {
    id: questionnaireCheckpointId(section.quiz),
    kind: 'questionnaire',
    label: section.title.trim() || diaryQuestionnaire(section.quiz)?.title || 'Опросник',
    questionnaire: section.quiz,
    everyDays: section.everyDays,
    ...(section.custom ? { custom: section.custom } : {}),
  };
}

/** An empty month calendar: the patient's own, with its title, before anything is marked. */
function emptyHeat(today: string): HeatDay[] {
  const range = heatmapRange(today, today);
  const days: HeatDay[] = [];
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
    days.push({ day, level: 0, symptoms: 0, done: 0, total: 0, entries: 0 });
  }
  return days;
}

/** One row per intake time, grouped by part of day, as the patient's checklist shows them. */
function drugRows(sections: readonly CareSectionDraft[]) {
  const timed: { period: DayPeriod; rows: { key: string; time: CareDoseDraft }[] }[] = [];
  const asNeeded: string[] = [];
  for (const section of sections) {
    if (section.kind !== 'drug') continue;
    const times = section.times.filter((time) => time.time);
    if (section.asNeeded || !times.length) {
      asNeeded.push(section.key);
      continue;
    }
    for (const time of times) {
      const period = dayPeriod(time.time);
      const group = timed.find((candidate) => candidate.period === period);
      const row = { key: section.key, time };
      if (group) group.rows.push(row);
      else timed.push({ period, rows: [row] });
    }
  }
  const order: readonly DayPeriod[] = ['morning', 'day', 'evening', 'night'];
  for (const group of timed) group.rows.sort((a, b) => a.time.time.localeCompare(b.time.time));
  timed.sort((a, b) => order.indexOf(a.period) - order.indexOf(b.period));
  return { timed, asNeeded };
}

const CHECK_KINDS: readonly CareSectionKind[] = [
  'score',
  'mood',
  'vitals',
  'body',
  'glucose',
  'activity',
  'meals',
  'text',
  'choice',
  'use',
];

const ONE_OF: readonly CareSectionKind[] = ['glucose', 'activity', 'meals'];

/**
 * The patient's day screen as the doctor builds it: the patient's own header, month calendar,
 * checklist rows and sections, each part the doctor can change framed in two-colour dashes with a
 * pencil. Editing opens in a sheet over the live screen; a questionnaire opens as the patient
 * fills it in, its pencil edits it.
 */
export function PatientScreenEditor(props: {
  readonly draft: CareDraft;
  readonly onChange: (draft: CareDraft) => void;
  readonly doctor: string;
  readonly onDoctor: (value: string) => void;
  readonly note: string;
  readonly onNote: (value: string) => void;
}): JSX.Element {
  const [editing, setEditing] = createSignal<string>();
  const [preview, setPreview] = createSignal<Preview>();
  const [adding, setAdding] = createSignal(false);
  // The doctor may tick rows like the patient would; nothing is recorded, a toast says so.
  const [ticked, setTicked] = createSignal<ReadonlySet<string>>(new Set());
  const tick = (id: string): void => {
    const next = new Set(ticked());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
    toast('Так отмечает пациент. Здесь это только показ — ничего не сохраняется.', {
      id: 'patient-screen-showcase',
    });
  };
  /** A ticked row is done; an unticked one looks as the patient sees it: an empty box (`open`), or
   * its own icon for what is taken when needed (`idle`). */
  const state = (id: string, untouched: 'open' | 'idle' = 'open'): 'done' | 'open' | 'idle' =>
    ticked().has(id) ? 'done' : untouched;
  const today = dayKey(new Date());
  const heat = emptyHeat(today);
  const patch = (next: Partial<CareDraft>): void => props.onChange({ ...props.draft, ...next });
  const sectionOf = (key: string | undefined): CareSectionDraft | undefined =>
    key ? props.draft.sections.find((section) => section.key === key) : undefined;
  const replace = (key: string, section: CareSectionDraft): void =>
    patch({
      sections: props.draft.sections.map((current) => (current.key === key ? section : current)),
    });
  const remove = (key: string): void => {
    setEditing(undefined);
    patch({ sections: props.draft.sections.filter((current) => current.key !== key) });
  };
  const quizzes = createMemo(
    () =>
      new Set(
        props.draft.sections
          .filter((section) => section.kind === 'questionnaire')
          .map((section) => section.quiz),
      ),
  );
  const drugs = (): number => props.draft.sections.filter((s) => s.kind === 'drug').length;
  /** Glucose, activity and meals ask fields with fixed ids: one section of each. */
  const has = (kind: CareSectionKind): boolean => props.draft.sections.some((s) => s.kind === kind);
  /** One «Зависимости» section per diary: its button waits once there is one. */
  const hasUse = (): boolean => props.draft.sections.some((s) => s.kind === 'use');
  /** The copy made last: its sheet opens with the schedule shown before a medicine is chosen. */
  const [copiedKey, setCopiedKey] = createSignal<string>();
  /** «Копия для другого»: the same schedule for the next medicine, in a sheet of its own. */
  const copy = (section: CareSectionDraft): void => {
    const next = copyCareSection(section);
    const at = props.draft.sections.findIndex((current) => current.key === section.key);
    const sections = [...props.draft.sections];
    sections.splice(at + 1, 0, next);
    patch({ sections });
    setCopiedKey(next.key);
    setEditing(next.key);
    toast.success('Назначение скопировано', {
      id: 'care-section-copied',
      description: `Расписание как у «${section.title.trim() || 'препарата'}» — выберите препарат.`,
    });
  };
  const add = (kind: CareSectionKind): void => {
    const quiz = DIARY_QUESTIONNAIRES.find((option) => !quizzes().has(option.slug))?.slug;
    const section = newCareSection(kind, quiz);
    patch({ sections: [...props.draft.sections, section] });
    setAdding(false);
    setEditing(section.key);
  };
  // Visits and lab tests (DIARY27): their own sheets, keyed like the sections.
  const [visit, setVisit] = createSignal<string>();
  const [labKey, setLabKey] = createSignal<string>();
  const visitOf = (key: string | undefined): CareAppointmentDraft | undefined =>
    key ? props.draft.appointments?.find((one) => one.key === key) : undefined;
  const labOf = (key: string | undefined): CareLabDraft | undefined =>
    key ? props.draft.labs?.find((one) => one.key === key) : undefined;
  const visitTitle = (one: CareAppointmentDraft): string => {
    if (!one.day) return 'Выберите день приёма';
    const when = appointmentWhen(
      { id: '', day: one.day, ...(one.time ? { time: one.time } : {}) },
      today,
    );
    return `${when[0]?.toUpperCase() ?? ''}${when.slice(1)}`;
  };
  const labDetail = (one: CareLabDraft): string | undefined =>
    [one.by ? `сдать до ${dayWords(one.by, today)}` : '', one.why.trim()]
      .filter(Boolean)
      .join(' · ') || undefined;
  const addVisit = (): void => {
    const next = newCareAppointment(addDays(today, 7));
    patch({ appointments: [...(props.draft.appointments ?? []), next] });
    setVisit(next.key);
  };
  const addLab = (): void => {
    const next = newCareLab();
    patch({ labs: [...(props.draft.labs ?? []), next] });
    setLabKey(next.key);
  };
  // CBT diaries and homework (CBT1): a pick from the library becomes this patient's copy.
  const [picking, setPicking] = createSignal(false);
  const [taskKey, setTaskKey] = createSignal<string>();
  const taskOf = (key: string | undefined): CareAssignmentDraft | undefined =>
    key ? props.draft.assignments?.find((one) => one.key === key) : undefined;
  const taskDetail = (one: CareAssignmentDraft): string =>
    assignmentScheduleWords({
      repeat: one.repeat,
      days: one.days,
      time: one.time || undefined,
      until: one.until || undefined,
    });
  const addTask = (worksheet: UserWorksheet): void => {
    const next = newCareAssignment(worksheet, today);
    patch({ assignments: [...(props.draft.assignments ?? []), next] });
    setPicking(false);
    setTaskKey(next.key);
  };
  const contactCount = (): number =>
    props.draft.contacts.filter((contact) => contact.value.trim()).length;
  // Rows are keyed by section key (strings), so an edit updates a row in place instead of
  // re-creating it.
  const doses = createMemo(() => drugRows(props.draft.sections));
  const checkKeys = createMemo(() =>
    props.draft.sections.filter((s) => CHECK_KINDS.includes(s.kind)).map((s) => s.key),
  );
  const quizKeys = createMemo(() =>
    props.draft.sections.filter((s) => s.kind === 'questionnaire').map((s) => s.key),
  );
  const titleOf = (section: CareSectionDraft | undefined): string =>
    !section
      ? ''
      : section.title.trim() ||
        (section.kind === 'drug' ? 'Выберите препарат' : CARE_SECTION_LABEL[section.kind]);
  const drugTitle = (section: CareSectionDraft | undefined): string =>
    [titleOf(section), section?.dose.trim()].filter(Boolean).join(' ');

  return (
    <div class="screen-editor diary-care-scope">
      <div class="screen-editor__frame">
        <header class="screen-editor__header care-editable">
          <p class="diary-today__title screen-editor__title">Дневник лечения</p>
          <div class="screen-editor__tools">
            <Show when={contactCount()}>
              <button
                type="button"
                class="diary-today__icon screen-editor__icon"
                aria-label={`Контакты врача: ${contactCount()}. Изменить`}
                onClick={() => setEditing('contacts')}
              >
                <AppGlyph name="phone" class="diary-today__icon-glyph" />
                <span class="screen-editor__badge" aria-hidden="true">
                  <AppGlyph name="edit" class="screen-editor__badge-glyph" />
                </span>
              </button>
            </Show>
            <button
              type="button"
              class="diary-today__icon diary-today__icon--help screen-editor__icon"
              aria-label="Кризисные контакты. Изменить"
              onClick={() => setEditing('contacts')}
            >
              <AppGlyph name="lifebuoy" class="diary-today__icon-glyph" />
            </button>
          </div>
          <EditableLine
            class="screen-editor__doctor"
            label="Врач"
            placeholder="Подпись врача"
            value={props.doctor}
            onInput={props.onDoctor}
          />
          <Show when={!contactCount()}>
            <button
              type="button"
              class="screen-editor__contact-add"
              onClick={() => setEditing('contacts')}
            >
              <AppGlyph name="plus" class="screen-editor__glyph" />
              <span class="screen-editor__contact-add-text">Контакт</span>
            </button>
          </Show>
        </header>

        <DiaryHeatmap days={heat} selected={today} today={today} onSelect={() => undefined} />

        <EditableLine
          class="diary-today__note screen-editor__note"
          label="Инструкция пациенту"
          placeholder="Инструкция пациенту"
          multiline
          value={props.note}
          onInput={props.onNote}
        />

        <section class="care-section">
          <h3 class="care-section__title">Лекарства</h3>
          <For each={doses().timed}>
            {(group) => (
              <>
                <p class="care-section__period">{DAY_PERIOD_LABEL[group.period]}</p>
                <ul class="care-section__list">
                  <For each={group.rows}>
                    {(row) => (
                      <CareRow
                        icon="pill"
                        mark={
                          <PillMark
                            name={sectionOf(row.key)?.title ?? ''}
                            form={sectionOf(row.key)?.form}
                          />
                        }
                        time={row.time.time}
                        title={drugTitle(sectionOf(row.key))}
                        detail={
                          [
                            row.time.meal ? DIARY_MEAL_LABEL[row.time.meal] : '',
                            sectionOf(row.key)?.course.length
                              ? describeRanges(sectionOf(row.key)?.course ?? [])
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' · ') || undefined
                        }
                        state={state(`${row.key}@${row.time.time}`)}
                        checkLabel={`${titleOf(sectionOf(row.key))} в ${row.time.time}: отметить, как пациент`}
                        tip={Boolean(sectionOf(row.key)?.tip.trim())}
                        onCheck={() => tick(`${row.key}@${row.time.time}`)}
                        onOpen={() => setEditing(row.key)}
                        onEdit={() => setEditing(row.key)}
                      />
                    )}
                  </For>
                </ul>
              </>
            )}
          </For>
          <Show when={doses().asNeeded.length}>
            <p class="care-section__period">При необходимости</p>
            <ul class="care-section__list">
              <For each={doses().asNeeded}>
                {(key) => (
                  <CareRow
                    icon="plus"
                    title={drugTitle(sectionOf(key))}
                    detail="Отметьте, когда примете"
                    state={state(key, 'idle')}
                    checkLabel={`${titleOf(sectionOf(key))}: отметить, как пациент`}
                    tip={Boolean(sectionOf(key)?.tip.trim())}
                    onCheck={() => tick(key)}
                    onOpen={() => setEditing(key)}
                    onEdit={() => setEditing(key)}
                  />
                )}
              </For>
            </ul>
          </Show>
          <button
            type="button"
            class="screen-editor__add care-editable care-editable--empty"
            disabled={drugs() >= MAX_DIARY_PLAN_ITEMS}
            onClick={() => add('drug')}
          >
            <AppGlyph name="plus" class="screen-editor__add-glyph" />
            <span class="screen-editor__add-text">Лекарство</span>
          </button>
        </section>

        <section class="care-section">
          <h3 class="care-section__title">Самочувствие и показатели</h3>
          <ul class="care-section__list">
            <For each={checkKeys()}>
              {(key) => (
                <CareRow
                  icon={KIND_ICON[sectionOf(key)?.kind ?? 'score']}
                  time={sectionOf(key)?.times.find((time) => time.time)?.time}
                  title={titleOf(sectionOf(key))}
                  detail={(() => {
                    const section = sectionOf(key);
                    return section ? sectionDetail(section) : undefined;
                  })()}
                  state={state(key)}
                  checkLabel={`${titleOf(sectionOf(key))}: отметить, как пациент`}
                  tip={Boolean(sectionOf(key)?.tip.trim())}
                  onCheck={() => tick(key)}
                  onOpen={() => setEditing(key)}
                  onEdit={() => setEditing(key)}
                />
              )}
            </For>
          </ul>
          <Show
            when={adding()}
            fallback={
              <button
                type="button"
                class="screen-editor__add care-editable care-editable--empty"
                onClick={() => setAdding(true)}
              >
                <AppGlyph name="plus" class="screen-editor__add-glyph" />
                <span class="screen-editor__add-text">Показатель</span>
              </button>
            }
          >
            <fieldset class="screen-editor__kinds screen-editor__kinds--set">
              <legend class="visually-hidden">Что добавить</legend>
              <For each={CHECK_KINDS}>
                {(kind) => (
                  <button
                    type="button"
                    class="screen-editor__kind"
                    disabled={(ONE_OF.includes(kind) && has(kind)) || (kind === 'use' && hasUse())}
                    onClick={() => add(kind)}
                  >
                    <AppGlyph name={KIND_ICON[kind]} class="screen-editor__kind-glyph" />
                    <span class="screen-editor__kind-text">{CARE_SECTION_LABEL[kind]}</span>
                  </button>
                )}
              </For>
              <Button
                type="button"
                variant="icon"
                class="screen-editor__kinds-close"
                aria-label="Не добавлять"
                icon={<AppGlyph name="close" class="screen-editor__glyph" />}
                onClick={() => setAdding(false)}
              />
            </fieldset>
          </Show>
        </section>

        <section class="care-section">
          <h3 class="care-section__title">Опросники</h3>
          <ul class="care-section__list">
            <For each={quizKeys()}>
              {(key) => (
                <CareRow
                  icon="list-checks"
                  title={titleOf(sectionOf(key))}
                  detail={(() => {
                    const section = sectionOf(key);
                    return section ? sectionDetail(section) : undefined;
                  })()}
                  state="idle"
                  checkLabel={`${titleOf(sectionOf(key))}: как увидит пациент`}
                  tip={Boolean(sectionOf(key)?.tip.trim())}
                  onCheck={() => setPreview({ kind: 'quiz', key })}
                  onOpen={() => setPreview({ kind: 'quiz', key })}
                  onEdit={() => setEditing(key)}
                  editLabel={`Изменить опросник ${titleOf(sectionOf(key))}`}
                />
              )}
            </For>
          </ul>
          <button
            type="button"
            class="screen-editor__add care-editable care-editable--empty"
            onClick={() => add('questionnaire')}
          >
            <AppGlyph name="plus" class="screen-editor__add-glyph" />
            <span class="screen-editor__add-text">Опросник</span>
          </button>
        </section>

        <section class="care-section">
          <h3 class="care-section__title">Задания</h3>
          <Show when={(props.draft.assignments ?? []).length}>
            <ul class="care-section__list">
              <For each={props.draft.assignments ?? []}>
                {(task) => (
                  <CareRow
                    icon="note-pencil"
                    title={task.worksheet.title}
                    detail={taskDetail(task)}
                    state={state(`task-${task.key}`)}
                    checkLabel={`${task.worksheet.title}: отметить, как пациент`}
                    tip={false}
                    onCheck={() => tick(`task-${task.key}`)}
                    onOpen={() => setTaskKey(task.key)}
                    onEdit={() => setTaskKey(task.key)}
                    editLabel={`Изменить задание: ${task.worksheet.title}`}
                  />
                )}
              </For>
            </ul>
          </Show>
          <button
            type="button"
            class="screen-editor__add care-editable care-editable--empty"
            disabled={(props.draft.assignments ?? []).length >= MAX_DIARY_ASSIGNMENTS}
            onClick={() => setPicking(true)}
          >
            <AppGlyph name="plus" class="screen-editor__add-glyph" />
            <span class="screen-editor__add-text">Задание</span>
          </button>
        </section>

        <section class="care-section">
          <h3 class="care-section__title">Приёмы у врача</h3>
          <Show when={(props.draft.appointments ?? []).length}>
            <ul class="care-section__list">
              <For each={props.draft.appointments ?? []}>
                {(visit) => (
                  <CareRow
                    icon="calendar-check"
                    title={visitTitle(visit)}
                    detail={visit.place.trim() || undefined}
                    state="idle"
                    checkLabel={`${visitTitle(visit)}: изменить`}
                    tip={false}
                    onCheck={() => setVisit(visit.key)}
                    onOpen={() => setVisit(visit.key)}
                    onEdit={() => setVisit(visit.key)}
                    editLabel={`Изменить приём: ${visitTitle(visit)}`}
                  />
                )}
              </For>
            </ul>
          </Show>
          <button
            type="button"
            class="screen-editor__add care-editable care-editable--empty"
            disabled={(props.draft.appointments ?? []).length >= MAX_DIARY_APPOINTMENTS}
            onClick={addVisit}
          >
            <AppGlyph name="plus" class="screen-editor__add-glyph" />
            <span class="screen-editor__add-text">Приём</span>
          </button>
        </section>

        <section class="care-section">
          <h3 class="care-section__title">Анализы</h3>
          <Show when={(props.draft.labs ?? []).length}>
            <ul class="care-section__list">
              <For each={props.draft.labs ?? []}>
                {(lab) => (
                  <CareRow
                    icon="flask"
                    title={lab.name.trim() || 'Анализ'}
                    detail={labDetail(lab)}
                    state="open"
                    checkLabel={`${lab.name.trim() || 'Анализ'}: изменить`}
                    tip={false}
                    onCheck={() => setLabKey(lab.key)}
                    onOpen={() => setLabKey(lab.key)}
                    onEdit={() => setLabKey(lab.key)}
                    editLabel={`Изменить анализ: ${lab.name.trim() || 'анализ'}`}
                  />
                )}
              </For>
            </ul>
          </Show>
          <button
            type="button"
            class="screen-editor__add care-editable care-editable--empty"
            disabled={(props.draft.labs ?? []).length >= MAX_DIARY_LABS}
            onClick={addLab}
          >
            <AppGlyph name="plus" class="screen-editor__add-glyph" />
            <span class="screen-editor__add-text">Анализ</span>
          </button>
        </section>

        <section class="care-section">
          <h3 class="care-section__title">Своими словами</h3>
          <ul class="care-section__list">
            <CareRow
              icon="note-pencil"
              title="Рассказать врачу"
              detail="что беспокоит — текстом или голосом; есть у каждого пациента"
              state={state('note')}
              checkLabel="Рассказать врачу своими словами"
              tip={false}
              onCheck={() => tick('note')}
              onOpen={() => tick('note')}
            />
          </ul>
        </section>
      </div>

      <Show when={visitOf(visit())}>
        {(current) => (
          <OverlayDialog
            open
            title="Приём у врача"
            class="screen-editor__dialog"
            onClose={() => setVisit(undefined)}
          >
            <AppointmentEditor
              appointment={current()}
              onChange={(next) =>
                patch({
                  appointments: (props.draft.appointments ?? []).map((one) =>
                    one.key === next.key ? next : one,
                  ),
                })
              }
              onRemove={() => {
                setVisit(undefined);
                patch({
                  appointments: (props.draft.appointments ?? []).filter(
                    (one) => one.key !== current().key,
                  ),
                });
              }}
              onDone={() => setVisit(undefined)}
            />
          </OverlayDialog>
        )}
      </Show>
      <Show when={picking()}>
        <OverlayDialog
          open
          title="Дневники и задания"
          class="screen-editor__dialog"
          onClose={() => setPicking(false)}
        >
          <Suspense>
            <WorksheetPicker onPick={addTask} />
          </Suspense>
        </OverlayDialog>
      </Show>
      <Show when={taskOf(taskKey())}>
        {(current) => (
          <OverlayDialog
            open
            title={current().worksheet.title}
            subtitle="Задание"
            class="screen-editor__dialog"
            onClose={() => setTaskKey(undefined)}
          >
            <Suspense>
              <AssignmentEditor
                assignment={current()}
                onChange={(next) =>
                  patch({
                    assignments: (props.draft.assignments ?? []).map((one) =>
                      one.key === next.key ? next : one,
                    ),
                  })
                }
                onRemove={() => {
                  setTaskKey(undefined);
                  patch({
                    assignments: (props.draft.assignments ?? []).filter(
                      (one) => one.key !== current().key,
                    ),
                  });
                }}
                onDone={() => setTaskKey(undefined)}
              />
            </Suspense>
          </OverlayDialog>
        )}
      </Show>
      <Show when={labOf(labKey())}>
        {(current) => (
          <OverlayDialog
            open
            title="Анализ"
            class="screen-editor__dialog"
            onClose={() => setLabKey(undefined)}
          >
            <LabEditor
              lab={current()}
              medicines={props.draft.sections
                .filter((section) => section.kind === 'drug' && section.title.trim())
                .map((section) => section.title)}
              asked={(props.draft.labs ?? [])
                .filter((one) => one.key !== current().key)
                .map((one) => one.name)}
              onChange={(next) =>
                patch({
                  labs: (props.draft.labs ?? []).map((one) => (one.key === next.key ? next : one)),
                })
              }
              onRemove={() => {
                setLabKey(undefined);
                patch({
                  labs: (props.draft.labs ?? []).filter((one) => one.key !== current().key),
                });
              }}
              onDone={() => setLabKey(undefined)}
            />
          </OverlayDialog>
        )}
      </Show>
      <Show when={editing() === 'contacts'}>
        <OverlayDialog
          open
          title="Контакты врача"
          class="screen-editor__dialog"
          headerStart={
            <span class="screen-editor__dialog-badge" aria-hidden="true">
              <AppGlyph name="phone" class="screen-editor__dialog-glyph" />
            </span>
          }
          onClose={() => setEditing(undefined)}
        >
          <ContactsEditor draft={props.draft} patch={patch} onDone={() => setEditing(undefined)} />
        </OverlayDialog>
      </Show>
      <Show when={sectionOf(editing())}>
        {(section) => (
          <OverlayDialog
            open
            title={titleOf(section())}
            subtitle={CARE_SECTION_LABEL[section().kind]}
            class="screen-editor__dialog"
            headerStart={
              <span class="screen-editor__dialog-badge" aria-hidden="true">
                <AppGlyph name={KIND_ICON[section().kind]} class="screen-editor__dialog-glyph" />
              </span>
            }
            onClose={() => setEditing(undefined)}
          >
            <SectionEditor
              section={section()}
              copied={copiedKey() === section().key}
              taken={quizzes()}
              onChange={(next) => replace(section().key, next)}
              onRemove={() => remove(section().key)}
              onDone={() => setEditing(undefined)}
              onPreview={() => setPreview({ kind: 'quiz', key: section().key })}
              onCopy={() => copy(section())}
            />
          </OverlayDialog>
        )}
      </Show>
      <Show
        when={(() => {
          const current = preview();
          return current ? sectionOf(current.key) : undefined;
        })()}
      >
        {(section) => (
          <Suspense>
            <QuestionnaireSheet
              day={today}
              checkpoint={quizCheckpoint(section())}
              entry={undefined}
              onSave={() => {
                // The doctor's try-out is not an answer: nothing is saved.
                setPreview(undefined);
                return undefined;
              }}
              onAlert={() => undefined}
              onClose={() => setPreview(undefined)}
            />
          </Suspense>
        )}
      </Show>
    </div>
  );
}
