import { createSignal, For, Index, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ChoiceChip } from '@/components/ChoiceChip';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SelectField } from '@/components/SelectField';
import { Switch } from '@/components/Switch';
import { Heading } from '@/components/Text';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import {
  type CareCheckId,
  type CareContactDraft,
  type CareDraft,
  type CareItemDraft,
  EMPTY_CARE_CONTACT,
  EMPTY_CARE_ITEM,
} from '@/features/diary/diary-care-draft';
import {
  type DiaryContactKind,
  type DiaryMeal,
  MAX_DIARY_CONTACTS,
  MAX_DIARY_DOSE_TIMES,
  MAX_DIARY_PLAN_ITEMS,
} from '@/features/diary/diary-model';
import { DIARY_QUESTIONNAIRES } from '@/features/diary/diary-questionnaires';
import type { DrugNameMatch } from '@/features/drug-picker/drug-name-match';
import { suggestDrugNames } from '@/features/drug-picker/drug-search';

const CHECK_LABELS: readonly { readonly id: CareCheckId; readonly label: string }[] = [
  { id: 'am', label: 'Самочувствие утром' },
  { id: 'pm', label: 'Самочувствие вечером' },
  { id: 'vitals', label: 'Пульс, давление, сатурация' },
];

const MEAL_OPTIONS: readonly { readonly value: DiaryMeal | 'any'; readonly label: string }[] = [
  { value: 'any', label: 'Любое' },
  { value: 'before', label: 'До еды' },
  { value: 'with', label: 'С едой' },
  { value: 'after', label: 'После' },
];

const PERIOD_OPTIONS = [
  { value: '7', label: 'Раз в неделю' },
  { value: '14', label: 'Раз в 2 недели' },
  { value: '30', label: 'Раз в месяц' },
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

/** The medicine name with suggestions from the shipped drug names (offline, debounced). */
function DrugNameField(props: {
  readonly value: string;
  readonly onInput: (value: string) => void;
}): JSX.Element {
  const [matches, setMatches] = createSignal<readonly DrugNameMatch[]>([]);
  let timer: number | undefined;
  let query = 0;
  onCleanup(() => window.clearTimeout(timer));
  const look = (text: string): void => {
    window.clearTimeout(timer);
    const current = ++query;
    timer = window.setTimeout(() => {
      suggestDrugNames(text)
        .then((found) => {
          if (current === query) setMatches(found);
        })
        .catch(() => setMatches([]));
    }, 220);
  };
  const display = (match: DrugNameMatch): string => {
    const name = match.name.toLocaleLowerCase('ru-RU');
    const generic = `${name[0]?.toLocaleUpperCase('ru-RU') ?? ''}${name.slice(1)}`;
    return match.product ? `${match.product} (${generic})` : generic;
  };
  return (
    <div class="diary-care-editor__drug">
      <TextField
        label="Препарат"
        hideLabel
        placeholder="Препарат"
        value={props.value}
        autocomplete="off"
        onInput={(event) => {
          props.onInput(event.currentTarget.value);
          look(event.currentTarget.value);
        }}
      />
      <Show when={matches().length}>
        <div class="diary-care-editor__suggestions">
          <For each={matches()}>
            {(match) => (
              <ChoiceChip
                compact
                onClick={() => {
                  props.onInput(display(match));
                  setMatches([]);
                }}
              >
                {display(match)}
              </ChoiceChip>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/**
 * The care diary part of «Выдать дневник»: medicines with intake times, the vitals and wellbeing
 * checkpoints (on by default), questionnaires, the doctor's contacts and help lines.
 */
export function DiaryCareEditor(props: {
  readonly draft: CareDraft;
  readonly onChange: (draft: CareDraft) => void;
}): JSX.Element {
  const patch = (next: Partial<CareDraft>): void => props.onChange({ ...props.draft, ...next });
  const patchItem = (index: number, next: Partial<CareItemDraft>): void =>
    patch({
      items: props.draft.items.map((item, position) =>
        position === index ? { ...item, ...next } : item,
      ),
    });
  const patchContact = (index: number, next: Partial<CareContactDraft>): void =>
    patch({
      contacts: props.draft.contacts.map((contact, position) =>
        position === index ? { ...contact, ...next } : contact,
      ),
    });
  const quiz = (slug: string) => props.draft.quizzes.find((candidate) => candidate.slug === slug);

  return (
    <div class="diary-care-editor">
      <section class="diary-care-editor__section">
        <Heading depth={3}>Лекарства</Heading>
        <Index each={props.draft.items}>
          {(item, index) => (
            <div class="diary-care-editor__item">
              <div class="diary-care-editor__item-head">
                <DrugNameField value={item().name} onInput={(name) => patchItem(index, { name })} />
                <TextField
                  label="Доза"
                  hideLabel
                  placeholder="Доза"
                  class="diary-care-editor__dose"
                  value={item().dose}
                  onInput={(event) => patchItem(index, { dose: event.currentTarget.value })}
                />
                <Button
                  type="button"
                  variant="icon"
                  aria-label="Убрать препарат"
                  icon={<AppGlyph name="trash" class="diary-care-editor__glyph" />}
                  disabled={props.draft.items.length === 1}
                  onClick={() =>
                    patch({ items: props.draft.items.filter((_, position) => position !== index) })
                  }
                />
              </div>
              <SegmentedControl
                label="Как принимать"
                stretch
                value={item().asNeeded ? 'needed' : 'timed'}
                options={[
                  { value: 'timed', label: 'По времени' },
                  { value: 'needed', label: 'При необходимости' },
                ]}
                onChange={(value) => patchItem(index, { asNeeded: value === 'needed' })}
              />
              <Show when={!item().asNeeded}>
                <Index each={item().times}>
                  {(time, timeIndex) => (
                    <div class="diary-care-editor__time">
                      <input
                        class="diary-care-editor__time-input"
                        type="time"
                        aria-label="Время приёма"
                        value={time().time}
                        onInput={(event) => {
                          const value = event.currentTarget.value;
                          patchItem(index, {
                            times: item().times.map((current, position) =>
                              position === timeIndex ? { ...current, time: value } : current,
                            ),
                          });
                        }}
                      />
                      <SegmentedControl
                        label="Еда"
                        class="diary-care-editor__meal"
                        value={time().meal ?? 'any'}
                        options={MEAL_OPTIONS}
                        onChange={(value) =>
                          patchItem(index, {
                            times: item().times.map((current, position) =>
                              position === timeIndex
                                ? { ...current, meal: value === 'any' ? undefined : value }
                                : current,
                            ),
                          })
                        }
                      />
                      <Button
                        type="button"
                        variant="icon"
                        aria-label={`Убрать приём в ${time().time}`}
                        icon={<AppGlyph name="close" class="diary-care-editor__glyph" />}
                        disabled={item().times.length === 1}
                        onClick={() =>
                          patchItem(index, {
                            times: item().times.filter((_, position) => position !== timeIndex),
                          })
                        }
                      />
                    </div>
                  )}
                </Index>
                <Button
                  type="button"
                  variant="quiet"
                  icon={<AppGlyph name="plus" class="diary-care-editor__glyph" />}
                  disabled={item().times.length >= MAX_DIARY_DOSE_TIMES}
                  onClick={() =>
                    patchItem(index, {
                      times: [...item().times, { time: '20:00', meal: undefined }],
                    })
                  }
                >
                  Время приёма
                </Button>
              </Show>
              <TextField
                label="Подсказка пациенту"
                hideLabel
                placeholder="Подсказка пациенту (необязательно)"
                value={item().tip}
                onInput={(event) => patchItem(index, { tip: event.currentTarget.value })}
              />
            </div>
          )}
        </Index>
        <Button
          type="button"
          variant="quiet"
          icon={<AppGlyph name="plus" class="diary-care-editor__glyph" />}
          disabled={props.draft.items.length >= MAX_DIARY_PLAN_ITEMS}
          onClick={() => patch({ items: [...props.draft.items, EMPTY_CARE_ITEM] })}
        >
          Препарат
        </Button>
      </section>

      <section class="diary-care-editor__section">
        <Heading depth={3}>Отметки</Heading>
        <For each={CHECK_LABELS}>
          {(check) => (
            <div class="diary-care-editor__check">
              <Switch
                aria-label={check.label}
                checked={props.draft.checks[check.id].on}
                onChange={(on) =>
                  patch({
                    checks: {
                      ...props.draft.checks,
                      [check.id]: { ...props.draft.checks[check.id], on },
                    },
                  })
                }
              />
              <span class="diary-care-editor__check-label">{check.label}</span>
              <input
                class="diary-care-editor__time-input"
                type="time"
                aria-label={`${check.label}: время`}
                disabled={!props.draft.checks[check.id].on}
                value={props.draft.checks[check.id].time}
                onInput={(event) => {
                  const time = event.currentTarget.value;
                  patch({
                    checks: {
                      ...props.draft.checks,
                      [check.id]: { ...props.draft.checks[check.id], time },
                    },
                  });
                }}
              />
            </div>
          )}
        </For>
      </section>

      <section class="diary-care-editor__section">
        <Heading depth={3}>Опросники</Heading>
        <div class="diary-care-editor__quizzes">
          <For each={DIARY_QUESTIONNAIRES}>
            {(option) => (
              <ChoiceChip
                accent={Boolean(quiz(option.slug))}
                aria-pressed={Boolean(quiz(option.slug))}
                detail={option.about}
                onClick={() =>
                  patch({
                    quizzes: quiz(option.slug)
                      ? props.draft.quizzes.filter((candidate) => candidate.slug !== option.slug)
                      : [...props.draft.quizzes, { slug: option.slug, everyDays: 7 }],
                  })
                }
              >
                {option.title}
              </ChoiceChip>
            )}
          </For>
        </div>
        <For each={props.draft.quizzes}>
          {(selected) => (
            <div class="diary-care-editor__check">
              <span class="diary-care-editor__check-label">
                {DIARY_QUESTIONNAIRES.find((option) => option.slug === selected.slug)?.title} —{' '}
                {DIARY_QUESTIONNAIRES.find((option) => option.slug === selected.slug)?.about}
              </span>
              <SegmentedControl
                label="Как часто"
                value={String(selected.everyDays) as '7' | '14' | '30'}
                options={PERIOD_OPTIONS}
                onChange={(value) =>
                  patch({
                    quizzes: props.draft.quizzes.map((candidate) =>
                      candidate.slug === selected.slug
                        ? { ...candidate, everyDays: Number(value) }
                        : candidate,
                    ),
                  })
                }
              />
            </div>
          )}
        </For>
      </section>

      <section class="diary-care-editor__section">
        <Heading depth={3}>Контакты врача</Heading>
        <Index each={props.draft.contacts}>
          {(contact, index) => (
            <div class="diary-care-editor__contact">
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
                label="Контакт"
                hideLabel
                placeholder={CONTACT_PLACEHOLDER[contact().kind]}
                value={contact().value}
                onInput={(event) => patchContact(index, { value: event.currentTarget.value })}
              />
              <TextField
                label="Подпись"
                hideLabel
                placeholder="Подпись (необязательно)"
                value={contact().label}
                onInput={(event) => patchContact(index, { label: event.currentTarget.value })}
              />
              <Button
                type="button"
                variant="icon"
                aria-label="Убрать контакт"
                icon={<AppGlyph name="trash" class="diary-care-editor__glyph" />}
                onClick={() =>
                  patch({
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
          icon={<AppGlyph name="plus" class="diary-care-editor__glyph" />}
          disabled={props.draft.contacts.length >= MAX_DIARY_CONTACTS}
          onClick={() => patch({ contacts: [...props.draft.contacts, EMPTY_CARE_CONTACT] })}
        >
          Контакт
        </Button>
        <TextArea
          label="Куда ещё обратиться в кризис (по строке)"
          value={props.draft.crisis}
          placeholder="Например: телефон доверия клиники"
          onInput={(event) => patch({ crisis: event.currentTarget.value })}
        />
      </section>
    </div>
  );
}
