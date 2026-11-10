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
import { SegmentedControl } from '@/components/SegmentedControl';
import { SelectField } from '@/components/SelectField';
import { Switch } from '@/components/Switch';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import { TimeField } from '@/components/TimeField';
import { QuestionnaireSheet } from '@/diary/QuestionnaireSheet';
import {
  CHECK_KINDS,
  drugTitle,
  KIND_ICON,
  labDetail,
  ONE_OF,
  sectionDetail,
  sectionTitle,
  taskDetail,
  timesText,
  visitTitle,
} from '@/features/diary/care-screen-rows';
import { addDays, dayKey } from '@/features/diary/diary-care';
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
import { type PastMedication, prescribingWarnings } from '@/features/diary/diary-med-history';
import {
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
import { SUBSTANCES } from '@/features/diary/diary-substances';
import { FormStep } from '@/features/diary/FormStep';
import { MedHistoryPanel, PastMedWarnings } from '@/features/diary/med-history/MedHistory';
import { useMedHistory } from '@/features/diary/med-history/plan-removals';
import { StudyEditor, studyFilled } from '@/features/diary/StudyEditor';
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

/** Contacts and help lines: a part of the form's last step. */
function ContactsEditor(props: {
  readonly draft: CareDraft;
  readonly patch: (next: Partial<CareDraft>) => void;
}): JSX.Element {
  const patchContact = (index: number, next: Partial<CareContactDraft>): void =>
    props.patch({
      contacts: props.draft.contacts.map((contact, position) =>
        position === index ? { ...contact, ...next } : contact,
      ),
    });
  return (
    <div class="screen-editor__contacts">
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
    </div>
  );
}

/** One thing the doctor added, as a row that opens its sheet. */
function FormRow(props: {
  readonly icon: AppGlyphName;
  readonly title: string;
  readonly detail?: string | undefined;
  readonly editLabel: string;
  readonly onOpen: () => void;
}): JSX.Element {
  return (
    <li class="form-row">
      <button
        type="button"
        class="form-row__main"
        aria-label={props.editLabel}
        onClick={() => props.onOpen()}
      >
        <AppGlyph name={props.icon} class="form-row__icon" />
        <span class="form-row__text">
          <span class="form-row__title">{props.title}</span>
          <Show when={props.detail}>
            <span class="form-row__detail">{props.detail}</span>
          </Show>
        </span>
        <AppGlyph name="edit" class="form-row__edit" />
      </button>
    </li>
  );
}

/** A «+ …» button of the form: a quiet secondary action with its icon. */
function AddButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant="secondary"
      class="form-add"
      disabled={props.disabled ?? false}
      icon={<AppGlyph name="plus" class="screen-editor__glyph" />}
      onClick={() => props.onClick()}
    >
      {props.label}
    </Button>
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

/** What a step list is called in the sheets' titles. */
const MARK_KINDS: readonly CareSectionKind[] = [...CHECK_KINDS, 'questionnaire'];

/**
 * The doctor's form for the patient's screen, steps 2–6 of the patient card (the first, «Профиль»,
 * is the parent's): past treatment, treatment now, what the patient marks, visits, labs and tasks,
 * contacts and help. Each step is a card with a heading and one line on what it is for. A thing
 * added opens its sheet; the patient's own screen is drawn beside it by `PatientView`, read-only.
 */
export function PatientScreenEditor(props: {
  readonly draft: CareDraft;
  readonly onChange: (draft: CareDraft) => void;
  readonly doctor: string;
  readonly onDoctor: (value: string) => void;
  readonly note: string;
  readonly onNote: (value: string) => void;
  /**
   * «Прошлое лечение»: what the patient took before. Absent where the diary keeps no history (the
   * local card's diary): the step is left out.
   */
  readonly history?: {
    readonly items: readonly PastMedication[];
    readonly onSave: (item: PastMedication) => Promise<void> | void;
    readonly onDelete: (id: string) => Promise<void> | void;
  };
  /** The number of the first step shown here (the parent's «Профиль» is 1). */
  readonly firstStep?: number;
}): JSX.Element {
  const [editing, setEditing] = createSignal<string>();
  const [preview, setPreview] = createSignal<Preview>();
  const today = dayKey(new Date());
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
  const drugs = createMemo(() => props.draft.sections.filter((s) => s.kind === 'drug'));
  const marks = createMemo(() => props.draft.sections.filter((s) => MARK_KINDS.includes(s.kind)));
  /** Glucose, activity and meals ask fields with fixed ids: one section of each. */
  const has = (kind: CareSectionKind): boolean => props.draft.sections.some((s) => s.kind === kind);
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
    setEditing(section.key);
  };
  // Visits and lab tests (DIARY27): their own sheets, keyed like the sections.
  const [visit, setVisit] = createSignal<string>();
  const [labKey, setLabKey] = createSignal<string>();
  const visitOf = (key: string | undefined): CareAppointmentDraft | undefined =>
    key ? props.draft.appointments?.find((one) => one.key === key) : undefined;
  const labOf = (key: string | undefined): CareLabDraft | undefined =>
    key ? props.draft.labs?.find((one) => one.key === key) : undefined;
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
  const addTask = (worksheet: UserWorksheet): void => {
    const next = newCareAssignment(worksheet, today);
    patch({ assignments: [...(props.draft.assignments ?? []), next] });
    setPicking(false);
    setTaskKey(next.key);
  };
  const visits = () => props.draft.appointments ?? [];
  const labs = () => props.draft.labs ?? [];
  const tasks = () => props.draft.assignments ?? [];
  const later = (): number => visits().length + labs().length + tasks().length;
  const first = props.firstStep ?? 2;
  const shift = (): number => (props.history ? 1 : 0);

  return (
    <div class="screen-editor">
      <Show when={props.history}>
        {(history) => (
          <FormStep
            step="past"
            number={first}
            title="Прошлое лечение"
            hint="Что пациент уже принимал: помогло ли, были ли реакции."
          >
            <MedHistoryPanel
              items={history().items}
              author="doctor"
              viewer="doctor"
              onSave={history().onSave}
              onDelete={history().onDelete}
            />
          </FormStep>
        )}
      </Show>

      <FormStep
        step="now"
        number={first + shift()}
        title="Лечение сейчас"
        hint="Лекарства, которые пациент принимает. Приём он отметит одним касанием."
      >
        <Show when={drugs().length}>
          <ul class="form-rows">
            <For each={drugs()}>
              {(section) => (
                <FormRow
                  icon="pill"
                  title={sectionTitle(section)}
                  detail={sectionDetail(section) || undefined}
                  editLabel={`Изменить: ${drugTitle(section)}`}
                  onOpen={() => setEditing(section.key)}
                />
              )}
            </For>
          </ul>
        </Show>
        <AddButton
          label="Лекарство"
          disabled={drugs().length >= MAX_DIARY_PLAN_ITEMS}
          onClick={() => add('drug')}
        />
      </FormStep>

      <FormStep
        step="marks"
        number={first + shift() + 1}
        title="Что отмечает пациент"
        hint="Самочувствие, давление, сон, опросники — всё, что он записывает сам."
      >
        <Show when={marks().length}>
          <ul class="form-rows">
            <For each={marks()}>
              {(section) => (
                <FormRow
                  icon={KIND_ICON[section.kind]}
                  title={sectionTitle(section)}
                  detail={sectionDetail(section) || undefined}
                  editLabel={`Изменить: ${sectionTitle(section)}`}
                  onOpen={() => setEditing(section.key)}
                />
              )}
            </For>
          </ul>
        </Show>
        <fieldset class="form-chips">
          <legend class="form-chips__legend">Добавить</legend>
          <For each={MARK_KINDS}>
            {(kind) => (
              <ChoiceChip
                compact
                class="form-chips__chip"
                icon={<AppGlyph name={KIND_ICON[kind]} class="form-chips__glyph" />}
                disabled={(ONE_OF.includes(kind) && has(kind)) || (kind === 'use' && has('use'))}
                onClick={() => add(kind)}
              >
                {CARE_SECTION_LABEL[kind]}
              </ChoiceChip>
            )}
          </For>
        </fieldset>
      </FormStep>

      <FormStep
        step="visits"
        number={first + shift() + 2}
        title="Приёмы, анализы, задания"
        hint="Назначенный визит, анализ или домашнее задание. Можно добавить позже."
      >
        <Show when={later()}>
          <ul class="form-rows">
            <For each={visits()}>
              {(one) => (
                <FormRow
                  icon="calendar-check"
                  title={visitTitle(one, today)}
                  detail={one.place.trim() || undefined}
                  editLabel={`Изменить приём: ${visitTitle(one, today)}`}
                  onOpen={() => setVisit(one.key)}
                />
              )}
            </For>
            <For each={labs()}>
              {(one) => (
                <FormRow
                  icon="flask"
                  title={one.name.trim() || 'Анализ'}
                  detail={labDetail(one, today)}
                  editLabel={`Изменить анализ: ${one.name.trim() || 'анализ'}`}
                  onOpen={() => setLabKey(one.key)}
                />
              )}
            </For>
            <For each={tasks()}>
              {(one) => (
                <FormRow
                  icon="note-pencil"
                  title={one.worksheet.title}
                  detail={taskDetail(one)}
                  editLabel={`Изменить задание: ${one.worksheet.title}`}
                  onOpen={() => setTaskKey(one.key)}
                />
              )}
            </For>
          </ul>
        </Show>
        <div class="form-adds">
          <AddButton
            label="Приём"
            disabled={visits().length >= MAX_DIARY_APPOINTMENTS}
            onClick={addVisit}
          />
          <AddButton label="Анализ" disabled={labs().length >= MAX_DIARY_LABS} onClick={addLab} />
          <AddButton
            label="Задание"
            disabled={tasks().length >= MAX_DIARY_ASSIGNMENTS}
            onClick={() => setPicking(true)}
          />
        </div>
      </FormStep>

      <FormStep
        step="contact"
        number={first + shift() + 3}
        title="Связь и помощь"
        hint="Подпись врача, контакты и куда обратиться, если станет очень плохо."
      >
        <TextField
          inputClass="screen-editor__input"
          label="Подпись врача"
          placeholder="Как пациент увидит врача"
          value={props.doctor}
          onInput={(event) => props.onDoctor(event.currentTarget.value)}
        />
        <TextArea
          textareaClass="screen-editor__input"
          label="Инструкция пациенту"
          maxLength={200}
          placeholder="Например: давление утром и вечером"
          value={props.note}
          onInput={(event) => props.onNote(event.currentTarget.value)}
        />
        <ContactsEditor draft={props.draft} patch={patch} />
        <Button
          type="button"
          variant="secondary"
          class="form-add"
          data-testid="study-editor-open"
          icon={<AppGlyph name="flask" class="screen-editor__glyph" />}
          onClick={() => setEditing('study')}
        >
          {studyFilled(props.draft.study)
            ? 'Участие в исследовании: подключено'
            : 'Участие в исследовании'}
        </Button>
      </FormStep>

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
      <Show when={editing() === 'study'}>
        <OverlayDialog
          open
          title="Исследование"
          subtitle="Участие добровольное"
          class="screen-editor__dialog"
          headerStart={
            <span class="screen-editor__dialog-badge" aria-hidden="true">
              <AppGlyph name="flask" class="screen-editor__dialog-glyph" />
            </span>
          }
          onClose={() => setEditing(undefined)}
        >
          <StudyEditor draft={props.draft} patch={patch} onDone={() => setEditing(undefined)} />
        </OverlayDialog>
      </Show>
      <Show when={sectionOf(editing())}>
        {(section) => (
          <OverlayDialog
            open
            title={sectionTitle(section())}
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
