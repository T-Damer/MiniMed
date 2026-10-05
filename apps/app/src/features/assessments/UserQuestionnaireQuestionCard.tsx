import { Index, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { SelectField } from '@/components/SelectField';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import { parseWeightInput } from '@/features/assessments/user-questionnaire-edit';
import { questionnaireSectionLabel } from '@/state/user-questionnaire-rules';
import {
  createUserQuestionnaireOption,
  type UserQuestionnaireQuestion,
  type UserQuestionnaireSection,
} from '@/state/user-questionnaires';

import '@/features/assessments/user-questionnaire-editor.css';

const MAX_OPTIONS = 12;
const NO_SECTION = '';

/**
 * One question of the questionnaire being edited: wording, explanation, pictures and answers with
 * their scores. It reports changes as plain functions over the question, so the page owns state.
 */
export function UserQuestionnaireQuestionCard(props: {
  readonly question: UserQuestionnaireQuestion;
  /** Position in the whole questionnaire, as the doctor will see it. */
  readonly number: number;
  readonly sections: readonly UserQuestionnaireSection[];
  /** Whether answers carry scores in this questionnaire (shows the score column). */
  readonly scored: boolean;
  readonly issues: readonly string[];
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly canDuplicate: boolean;
  readonly onChange: (
    update: (question: UserQuestionnaireQuestion) => UserQuestionnaireQuestion,
  ) => void;
  readonly onMove: (direction: -1 | 1) => void;
  readonly onDuplicate: () => void;
  readonly onRemove: () => void;
  readonly onMoveToSection: (sectionId: string | undefined) => void;
  readonly onAddImages: () => void;
  readonly onRemoveImage: (imageId: string) => void;
}): JSX.Element {
  const question = () => props.question;
  const sectionOptions = () => [
    { value: NO_SECTION, label: 'Без раздела' },
    ...props.sections.map((section, index) => ({
      value: section.id,
      label: questionnaireSectionLabel(section, index),
    })),
  ];
  return (
    <article
      class="questionnaire-question paper-card"
      classList={{ 'questionnaire-question--invalid': props.issues.length > 0 }}
      data-testid="questionnaire-question"
      data-question-id={question().id}
    >
      <header class="questionnaire-question__header">
        <h3 class="questionnaire-question__title">Вопрос {props.number}</h3>
        <div class="questionnaire-question__actions">
          <Button
            type="button"
            variant="icon"
            class="questionnaire-question__action"
            aria-label={`Поднять вопрос ${props.number} выше`}
            title="Выше"
            disabled={!props.canMoveUp}
            onClick={() => props.onMove(-1)}
            icon={<AppGlyph name="caret-up" class="questionnaire-question__icon" />}
          />
          <Button
            type="button"
            variant="icon"
            class="questionnaire-question__action"
            aria-label={`Опустить вопрос ${props.number} ниже`}
            title="Ниже"
            disabled={!props.canMoveDown}
            onClick={() => props.onMove(1)}
            icon={<AppGlyph name="caret-down" class="questionnaire-question__icon" />}
          />
          <Button
            type="button"
            variant="icon"
            class="questionnaire-question__action"
            aria-label={`Копировать вопрос ${props.number}`}
            title="Копировать вопрос"
            disabled={!props.canDuplicate}
            onClick={props.onDuplicate}
            icon={<AppGlyph name="squares-four" class="questionnaire-question__icon" />}
          />
          <Button
            type="button"
            variant="icon"
            class="questionnaire-question__action"
            aria-label={`Удалить вопрос ${props.number}`}
            title="Удалить вопрос"
            onClick={props.onRemove}
            icon={<AppGlyph name="trash" class="questionnaire-question__icon" />}
          />
        </div>
      </header>

      <Show when={props.sections.length > 0}>
        <SelectField
          class="questionnaire-question__section"
          label="Раздел"
          options={sectionOptions()}
          value={question().sectionId ?? NO_SECTION}
          onChange={(event) => props.onMoveToSection(event.currentTarget.value || undefined)}
        />
      </Show>

      <TextArea
        class="questionnaire-question__field"
        label="Формулировка"
        value={question().prompt}
        rows={2}
        onInput={(event) => {
          const prompt = event.currentTarget.value;
          props.onChange((current) => ({ ...current, prompt }));
        }}
      />
      <TextArea
        class="questionnaire-question__field"
        label="Пояснение перед ответами"
        value={question().text}
        rows={2}
        placeholder="Необязательно: как отвечать, на что обратить внимание"
        onInput={(event) => {
          const text = event.currentTarget.value;
          props.onChange((current) => ({ ...current, text }));
        }}
      />

      <section class="questionnaire-question__media" aria-label="Изображения к вопросу">
        <header class="questionnaire-question__subheader">
          <h4 class="questionnaire-question__subtitle">Изображения</h4>
          <Button
            type="button"
            variant="secondary"
            class="questionnaire-question__add-image"
            onClick={props.onAddImages}
            icon={<AppGlyph name="image" class="questionnaire-question__icon" />}
          >
            Добавить
          </Button>
        </header>
        <Show when={question().images.length > 0}>
          <div class="questionnaire-question__images">
            <Index each={question().images}>
              {(image) => (
                <figure class="questionnaire-question__image-card">
                  <img
                    class="questionnaire-question__image"
                    src={image().dataUrl}
                    alt={image().name}
                  />
                  <Button
                    type="button"
                    variant="icon"
                    class="questionnaire-question__image-remove"
                    aria-label={`Удалить изображение «${image().name}»`}
                    onClick={() => props.onRemoveImage(image().id)}
                    icon={<AppGlyph name="trash" class="questionnaire-question__icon" />}
                  />
                </figure>
              )}
            </Index>
          </div>
        </Show>
      </section>

      <section class="questionnaire-question__answers" aria-label="Варианты ответа">
        <header class="questionnaire-question__subheader">
          <h4 class="questionnaire-question__subtitle">Варианты ответов</h4>
          <span class="questionnaire-question__hint">
            {props.scored ? 'Баллы — у всех ответов' : 'Баллы необязательны'}
          </span>
        </header>
        <Index each={question().options}>
          {(option) => (
            <div class="questionnaire-question__option" data-testid="questionnaire-option">
              <TextField
                class="questionnaire-question__option-label"
                label="Ответ"
                value={option().label}
                onInput={(event) => {
                  const label = event.currentTarget.value;
                  props.onChange((current) => ({
                    ...current,
                    options: current.options.map((item) =>
                      item.id === option().id ? { ...item, label } : item,
                    ),
                  }));
                }}
              />
              <TextField
                class="questionnaire-question__option-weight"
                label="Баллы"
                inputmode="decimal"
                placeholder="—"
                value={option().weight ?? ''}
                onInput={(event) => {
                  const parsed = parseWeightInput(event.currentTarget.value);
                  if (!parsed.ok) return;
                  props.onChange((current) => ({
                    ...current,
                    options: current.options.map((item) => {
                      if (item.id !== option().id) return item;
                      const { weight: _previous, ...rest } = item;
                      return parsed.value === undefined ? rest : { ...rest, weight: parsed.value };
                    }),
                  }));
                }}
              />
              <Show when={question().options.length > 2}>
                <Button
                  type="button"
                  variant="icon"
                  class="questionnaire-question__remove-option"
                  aria-label={`Удалить ответ «${option().label}»`}
                  onClick={() =>
                    props.onChange((current) => ({
                      ...current,
                      options: current.options.filter((item) => item.id !== option().id),
                    }))
                  }
                  icon={<AppGlyph name="minus" class="questionnaire-question__icon" />}
                />
              </Show>
            </div>
          )}
        </Index>
        <Button
          type="button"
          variant="secondary"
          class="questionnaire-question__add-option"
          disabled={question().options.length >= MAX_OPTIONS}
          onClick={() =>
            props.onChange((current) => ({
              ...current,
              options: [...current.options, createUserQuestionnaireOption('')],
            }))
          }
          icon={<AppGlyph name="plus" class="questionnaire-question__icon" />}
        >
          Вариант ответа
        </Button>
      </section>

      <Show when={props.issues.length > 0}>
        <ul class="questionnaire-question__issues" role="alert">
          <Index each={props.issues}>
            {(message) => <li class="questionnaire-question__issue">{message()}</li>}
          </Index>
        </ul>
      </Show>
    </article>
  );
}
