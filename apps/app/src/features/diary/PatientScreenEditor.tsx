import { createMemo, createResource, createSignal, For, Index, type JSX, Show } from 'solid-js';

import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ChoiceChip } from '@/components/ChoiceChip';
import { DateRangeCalendar } from '@/components/DateRangeCalendar';
import { countDays, describeRanges } from '@/components/date-ranges';
import { NativeDateTimeField } from '@/components/NativeDateTimeField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SelectField } from '@/components/SelectField';
import { Switch } from '@/components/Switch';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import {
  CARE_SECTION_LABEL,
  type CareContactDraft,
  type CareDoseDraft,
  type CareDraft,
  type CareSectionDraft,
  type CareSectionKind,
  EMPTY_CARE_CONTACT,
  newCareSection,
  newCustomQuestionnaireSection,
} from '@/features/diary/diary-care-draft';
import {
  DIARY_MEAL_LABEL,
  type DiaryContactKind,
  type DiaryMeal,
  MAX_DIARY_CONTACTS,
  MAX_DIARY_DOSE_TIMES,
  MAX_DIARY_OPTIONS,
  MAX_DIARY_PLAN_ITEMS,
} from '@/features/diary/diary-model';
import {
  listOwnQuestionnaires,
  loadOwnQuestionnaire,
  OWN_QUESTIONNAIRE_NEW_HASH,
} from '@/features/diary/diary-own-questionnaires';
import { DIARY_QUESTIONNAIRES, diaryQuestionnaire } from '@/features/diary/diary-questionnaires';
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
  text: 'note-pencil',
  choice: 'list-checks',
  questionnaire: 'list-numbers',
};

const KIND_ORDER: readonly CareSectionKind[] = [
  'drug',
  'score',
  'mood',
  'vitals',
  'body',
  'text',
  'choice',
  'questionnaire',
];

/** The groups of the patient's day screen, in its order. */
const GROUPS: readonly { readonly title: string; readonly kinds: readonly CareSectionKind[] }[] = [
  { title: 'Лекарства', kinds: ['drug'] },
  {
    title: 'Самочувствие и показатели',
    kinds: ['score', 'mood', 'vitals', 'body', 'text', 'choice'],
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
    case 'questionnaire':
      return `${diaryQuestionnaire(section.quiz)?.about ?? 'свой опросник'} · раз в ${section.everyDays} дн.`;
    default:
      return section.times.length ? timesText(section.times) : 'в любое время дня';
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
          class={`screen-editor__editable ${props.class}`}
          classList={{ 'screen-editor__editable--empty': !props.value.trim() }}
          onClick={() => setEditing(true)}
        >
          <Show when={!props.value.trim()}>
            <AppGlyph name="plus" class="screen-editor__editable-glyph" />
          </Show>
          <span class="screen-editor__editable-text">
            {props.value.trim() || props.placeholder}
          </span>
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
            <NativeDateTimeField
              type="time"
              label="Время"
              placeholder="--:--"
              class="screen-editor__time-field"
              buttonClass="screen-editor__time-button"
              value={time().time}
              onChange={(value) => patch(index, { time: value })}
            />
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
        variant="quiet"
        class="screen-editor__add-time"
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
        Время
      </Button>
    </div>
  );
}

function DrugFields(props: {
  readonly section: CareSectionDraft;
  readonly frequent: readonly string[];
  readonly patch: (next: Partial<CareSectionDraft>) => void;
}): JSX.Element {
  const [forms, setForms] = createSignal<readonly DrugSuggestionForm[]>([]);
  const [calendar, setCalendar] = createSignal(false);
  const strengths = (): readonly string[] =>
    forms().find((form) => form.form === props.section.form)?.strengths ?? [];
  return (
    <>
      <DrugSearchField
        label="Препарат"
        placeholder="Начните вводить название"
        value={props.section.title}
        onInput={(title) => props.patch({ title })}
        onPick={(picked) => {
          setForms(picked.forms);
          const first = picked.forms[0];
          props.patch({
            title: picked.product ?? picked.name,
            form: first?.form ?? props.section.form,
            dose: first?.strengths[0] ?? props.section.dose,
          });
        }}
      />
      <Show when={!props.section.title.trim() && props.frequent.length}>
        <fieldset class="screen-editor__chips screen-editor__chips--set">
          <legend class="visually-hidden">Часто назначаете</legend>
          <For each={props.frequent}>
            {(name) => (
              <ChoiceChip compact onClick={() => props.patch({ title: name })}>
                {name}
              </ChoiceChip>
            )}
          </For>
        </fieldset>
      </Show>
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
      <Show when={forms().length > 1 || strengths().length > 1}>
        <div class="screen-editor__chips">
          <For each={forms().length > 1 ? forms() : []}>
            {(form) => (
              <ChoiceChip
                compact
                accent={props.section.form === form.form}
                aria-pressed={props.section.form === form.form}
                onClick={() =>
                  props.patch({ form: form.form, dose: form.strengths[0] ?? props.section.dose })
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
          <ChoiceChip compact onClick={() => props.patch({ signa: suggestedSigna(props.section) })}>
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
        variant="quiet"
        icon={<AppGlyph name="plus" class="screen-editor__glyph" />}
        disabled={props.section.options.length >= MAX_DIARY_OPTIONS}
        onClick={() => props.patch({ options: [...props.section.options, ''] })}
      >
        Вариант
      </Button>
    </div>
  );
}

/** The editor that opens in place of a row of the preview. */
function SectionEditor(props: {
  readonly section: CareSectionDraft;
  readonly frequent: readonly string[];
  readonly taken: ReadonlySet<string>;
  readonly onChange: (section: CareSectionDraft) => void;
  readonly onRemove: () => void;
  readonly onDone: () => void;
}): JSX.Element {
  const patch = (next: Partial<CareSectionDraft>): void =>
    props.onChange({ ...props.section, ...next });
  // The doctor's own questionnaires from the main app's builder, read when a questionnaire opens.
  const [own] = createResource(
    () => props.section.kind === 'questionnaire',
    (open) => (open ? listOwnQuestionnaires() : Promise.resolve([])),
  );
  const [ownError, setOwnError] = createSignal('');
  return (
    <div class="screen-editor__sheet">
      <Show when={props.section.kind === 'drug'}>
        <DrugFields section={props.section} frequent={props.frequent} patch={patch} />
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
          <For each={own() ?? []}>
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
        <TimesEditor
          times={props.section.times}
          meals={false}
          emptyText="Раз в день, в любое время"
          onChange={(times) => patch({ times })}
        />
      </Show>
      <TextField
        inputClass="screen-editor__input"
        label="Подсказка пациенту"
        placeholder="Пациент увидит «?» рядом с разделом"
        value={props.section.tip}
        onInput={(event) => patch({ tip: event.currentTarget.value })}
      />
      <div class="screen-editor__sheet-actions">
        <Button
          type="button"
          variant="icon"
          class="screen-editor__remove"
          aria-label={`Удалить раздел ${props.section.title || CARE_SECTION_LABEL[props.section.kind]}`}
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
            <TextField
              inputClass="screen-editor__input"
              label="Подпись"
              hideLabel
              placeholder="Подпись"
              value={contact().label}
              onInput={(event) => patchContact(index, { label: event.currentTarget.value })}
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
          </div>
        )}
      </Index>
      <Button
        type="button"
        variant="quiet"
        icon={<AppGlyph name="plus" class="screen-editor__glyph" />}
        disabled={props.draft.contacts.length >= MAX_DIARY_CONTACTS}
        onClick={() => props.patch({ contacts: [...props.draft.contacts, EMPTY_CARE_CONTACT] })}
      >
        Контакт
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

/**
 * The patient's day screen as the doctor builds it: the same header, note and grouped rows the
 * patient will see. A tap on any part edits it in place; «Добавить раздел» adds a medicine, a
 * wellbeing score, vitals, a description, a choice or a questionnaire.
 */
export function PatientScreenEditor(props: {
  readonly draft: CareDraft;
  readonly onChange: (draft: CareDraft) => void;
  readonly doctor: string;
  readonly onDoctor: (value: string) => void;
  readonly note: string;
  readonly onNote: (value: string) => void;
  /** Medicines this doctor prescribes most, offered while a medicine name is empty. */
  readonly frequent?: readonly string[];
}): JSX.Element {
  const [open, setOpen] = createSignal<string>();
  const [adding, setAdding] = createSignal(false);
  const patch = (next: Partial<CareDraft>): void => props.onChange({ ...props.draft, ...next });
  const replace = (key: string, section: CareSectionDraft): void =>
    patch({
      sections: props.draft.sections.map((current) => (current.key === key ? section : current)),
    });
  const remove = (key: string): void => {
    patch({ sections: props.draft.sections.filter((current) => current.key !== key) });
    setOpen(undefined);
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
  const add = (kind: CareSectionKind): void => {
    const quiz = DIARY_QUESTIONNAIRES.find((option) => !quizzes().has(option.slug))?.slug;
    const section = newCareSection(kind, quiz);
    patch({ sections: [...props.draft.sections, section] });
    setAdding(false);
    setOpen(section.key);
  };
  const contactCount = (): number =>
    props.draft.contacts.filter((contact) => contact.value.trim()).length;

  return (
    <div class="screen-editor">
      <div class="screen-editor__frame">
        <header class="screen-editor__header screen-editor__header--doctor">
          <div class="screen-editor__titles">
            <p class="screen-editor__title">Дневник лечения</p>
            <EditableLine
              class="screen-editor__doctor"
              label="Врач"
              placeholder="Подпись врача"
              value={props.doctor}
              onInput={props.onDoctor}
            />
          </div>
          <button
            type="button"
            class="screen-editor__icon screen-editor__icon--doctor"
            classList={{ 'screen-editor__icon--on': open() === 'contacts' }}
            aria-label={`Контакты врача: ${contactCount()}`}
            aria-expanded={open() === 'contacts'}
            onClick={() => setOpen(open() === 'contacts' ? undefined : 'contacts')}
          >
            <AppGlyph name="phone" class="screen-editor__icon-glyph" />
            <Show when={!contactCount()}>
              <span class="screen-editor__badge screen-editor__badge--doctor" aria-hidden="true">
                +
              </span>
            </Show>
          </button>
          <button
            type="button"
            class="screen-editor__icon screen-editor__icon--help"
            aria-label="Кризисные контакты"
            onClick={() => setOpen(open() === 'contacts' ? undefined : 'contacts')}
          >
            <AppGlyph name="lifebuoy" class="screen-editor__icon-glyph" />
          </button>
        </header>
        <Show when={open() === 'contacts'}>
          <ContactsEditor draft={props.draft} patch={patch} onDone={() => setOpen(undefined)} />
        </Show>

        <div class="screen-editor__heat" aria-hidden="true">
          <For each={Array.from({ length: 28 }, (_, index) => index)}>
            {(index) => (
              <span
                class="screen-editor__heat-day"
                classList={{ 'screen-editor__heat-day--today': index === 27 }}
              />
            )}
          </For>
        </div>

        <EditableLine
          class="screen-editor__note"
          label="Инструкция пациенту"
          placeholder="Инструкция пациенту"
          multiline
          value={props.note}
          onInput={props.onNote}
        />

        <For each={GROUPS}>
          {(group) => (
            <Show when={props.draft.sections.some((s) => group.kinds.includes(s.kind))}>
              <section class="screen-editor__group">
                <h3 class="screen-editor__group-title">{group.title}</h3>
                <ul class="screen-editor__list">
                  <For each={props.draft.sections.filter((s) => group.kinds.includes(s.kind))}>
                    {(section) => (
                      <li
                        class="screen-editor__item"
                        classList={{ 'screen-editor__item--open': open() === section.key }}
                      >
                        <button
                          type="button"
                          class="screen-editor__row"
                          aria-expanded={open() === section.key}
                          onClick={() => setOpen(open() === section.key ? undefined : section.key)}
                        >
                          <span class="screen-editor__row-check" aria-hidden="true">
                            <AppGlyph
                              name={KIND_ICON[section.kind]}
                              class="screen-editor__row-icon"
                            />
                          </span>
                          <span class="screen-editor__row-main">
                            <span class="screen-editor__row-title">
                              {section.title.trim() ||
                                (section.kind === 'drug'
                                  ? 'Выберите препарат'
                                  : CARE_SECTION_LABEL[section.kind])}
                              <Show when={section.tip.trim()}>
                                <span class="screen-editor__row-tip" aria-hidden="true">
                                  ?
                                </span>
                                <span class="visually-hidden">Есть подсказка</span>
                              </Show>
                            </span>
                            <Show when={sectionDetail(section)}>
                              <span class="screen-editor__row-detail">
                                {sectionDetail(section)}
                              </span>
                            </Show>
                          </span>
                          <AppGlyph
                            name={open() === section.key ? 'caret-up' : 'edit'}
                            class="screen-editor__row-edit"
                          />
                        </button>
                        <Show when={open() === section.key}>
                          <SectionEditor
                            section={section}
                            frequent={props.frequent ?? []}
                            taken={quizzes()}
                            onChange={(next) => replace(section.key, next)}
                            onRemove={() => remove(section.key)}
                            onDone={() => setOpen(undefined)}
                          />
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            </Show>
          )}
        </For>

        <Show
          when={adding()}
          fallback={
            <button type="button" class="screen-editor__add" onClick={() => setAdding(true)}>
              <AppGlyph name="plus" class="screen-editor__add-glyph" />
              <span class="screen-editor__add-text">Добавить раздел</span>
            </button>
          }
        >
          <fieldset class="screen-editor__kinds screen-editor__kinds--set">
            <legend class="visually-hidden">Вид раздела</legend>
            <For each={KIND_ORDER}>
              {(kind) => (
                <button
                  type="button"
                  class="screen-editor__kind"
                  disabled={(kind === 'drug' && drugs() >= MAX_DIARY_PLAN_ITEMS) || false}
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

        <p class="screen-editor__ghost" aria-hidden="true">
          <AppGlyph name="note-pencil" class="screen-editor__glyph" />
          Добавить описание состояния
        </p>
      </div>
    </div>
  );
}
