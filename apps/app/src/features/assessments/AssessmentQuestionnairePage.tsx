import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import NumberFlow from 'solid-number-flow';

import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { HorizontalScroller } from '@/components/HorizontalScroller';
import { AssessmentBackNav } from '@/features/assessments/AssessmentBackNav';
import { AssessmentDefinitionNotice } from '@/features/assessments/AssessmentDefinitionNotice';
import { answeredQuestionCount, scoreAssessment } from '@/features/assessments/assessment-engine';
import { printBlankAssessment } from '@/features/assessments/assessment-print';
import { assessmentWorkspaceCrumbs } from '@/features/assessments/assessment-routing';
import type {
  AssessmentDefinition,
  AssessmentRecord,
  AssessmentResponseValue,
  IncompleteAssessmentRecord,
} from '@/features/assessments/assessment-types';
import {
  createCompletedAssessmentRecord,
  saveIncompleteAssessmentRecord,
} from '@/state/assessment-results';
import { loadPatientNotes } from '@/state/patient-notes';

export function AssessmentQuestionnairePage(props: {
  readonly definition: AssessmentDefinition;
  readonly sectionTitle: string;
  readonly initialRecord?: IncompleteAssessmentRecord | undefined;
  readonly onBack: () => void;
  readonly onSaved: (record: AssessmentRecord) => void;
  readonly onDraftSaved: (record: IncompleteAssessmentRecord) => void;
  readonly onMessage: (message: string) => void;
}): JSX.Element {
  const [answers, setAnswers] = createSignal<Record<string, AssessmentResponseValue>>(
    props.initialRecord?.answers ?? {},
  );
  const [subjectLabel, setSubjectLabel] = createSignal(props.initialRecord?.subjectLabel ?? '');
  const [methodologyOpen, setMethodologyOpen] = createSignal(false);
  const [highlightedQuestionId, setHighlightedQuestionId] = createSignal<string | null>(null);
  let draftId = props.initialRecord?.id;
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  const answered = () => answeredQuestionCount(props.definition, answers());
  const complete = () => answered() === props.definition.questions.length;
  const remaining = () => props.definition.questions.length - answered();
  const patientSuggestions = () => loadPatientNotes().cards.map((card) => card.title);

  const saveDraft = (
    nextAnswers: Record<string, AssessmentResponseValue>,
    nextSubjectLabel = subjectLabel(),
  ): void => {
    if (Object.keys(nextAnswers).length === 0 && !nextSubjectLabel.trim()) return;
    const record = saveIncompleteAssessmentRecord({
      ...(draftId ? { id: draftId } : {}),
      assessmentId: props.definition.id,
      subjectLabel: nextSubjectLabel,
      answers: nextAnswers,
      totalQuestions: props.definition.questions.length,
    });
    draftId = record.id;
    props.onDraftSaved(record);
  };

  const submit = (): void => {
    const result = scoreAssessment(props.definition, answers());
    if (!result.ok) {
      props.onMessage(result.error);
      return;
    }
    props.onSaved(
      createCompletedAssessmentRecord({
        ...(draftId ? { id: draftId } : {}),
        assessmentId: props.definition.id,
        subjectLabel: subjectLabel(),
        answers: answers(),
        result: result.value,
      }),
    );
  };

  const scrollToNextQuestion = (): void => {
    const target = document.querySelector<HTMLElement>(
      '.assessment-questionnaire .assessment-question:not(:has(input:checked))',
    );
    if (!target) return;
    const questionId = target.dataset['questionId'] ?? null;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!questionId) return;
    setHighlightedQuestionId(questionId);
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightTimer = undefined;
      setHighlightedQuestionId(null);
    }, 1100);
  };

  onCleanup(() => {
    if (highlightTimer) clearTimeout(highlightTimer);
  });

  const responseOptionLabel = (
    questionId: string,
    option: { value: AssessmentResponseValue; label: string },
    scroll = false,
  ): JSX.Element => (
    <label
      class="assessment-response-options__option"
      classList={{
        'assessment-response-options__option--selected': answers()[questionId] === option.value,
        'assessment-response-options__option--scroll': scroll,
      }}
    >
      <input
        class="assessment-response-options__input"
        type="radio"
        name={questionId}
        value={option.value}
        checked={answers()[questionId] === option.value}
        onChange={() => {
          const nextAnswers = { ...answers(), [questionId]: option.value };
          setAnswers(nextAnswers);
          saveDraft(nextAnswers);
        }}
      />
      <span
        class="assessment-response-options__value"
        classList={{
          'assessment-response-options__value--selected': answers()[questionId] === option.value,
        }}
        aria-hidden="true"
      >
        {option.value}
      </span>
      <small class="assessment-response-options__label">
        <span class="assessment-response-options__text">{option.label}</span>
      </small>
    </label>
  );

  return (
    <div class="assessment-workspace">
      <header class="assessment-subpage-header">
        <div class="assessment-subpage-header__nav">
          <AssessmentBackNav sectionTitle={props.sectionTitle} onBackToCatalog={props.onBack} />
          <AppBreadcrumbs
            items={assessmentWorkspaceCrumbs(props.definition)}
            onNavigate={(href) => {
              window.location.hash = href;
            }}
          />
        </div>
        <div class="assessment-subpage-header__body">
          <div class="assessment-subpage-header__content">
            <h1 class="assessment-subpage-title">{props.definition.title}</h1>
          </div>
          <div class="assessment-subpage-header-actions assessment-subpage-header-actions--trailing">
            <Button
              type="button"
              variant="icon"
              class="knowledge-back-button assessment-questionnaire-print"
              aria-label="Распечатать бланк теста"
              title="Распечатать бланк теста"
              onClick={() => printBlankAssessment(props.definition)}
              icon={<AppGlyph name="printer" class="assessment-questionnaire-print__icon" />}
            />
            <Button
              type="button"
              variant="icon"
              class="knowledge-back-button assessment-help-button"
              aria-label="Методика и ограничения"
              title="Методика и ограничения"
              onClick={() => setMethodologyOpen(true)}
              icon={<AppGlyph name="question" class="assessment-help-button__icon" />}
            />
          </div>
        </div>
      </header>

      <div class="assessment-toolbar">
        <label class="assessment-toolbar__field">
          <span class="assessment-toolbar__label">Имя / название — необязательно</span>
          <input
            class="assessment-toolbar__input"
            list="assessment-patient-suggestions"
            value={subjectLabel()}
            placeholder="Имя, номер карты или псевдоним"
            onInput={(event) => {
              const value = event.currentTarget.value;
              setSubjectLabel(value);
              saveDraft(answers(), value);
            }}
          />
          <datalist id="assessment-patient-suggestions">
            <For each={patientSuggestions()}>{(suggestion) => <option value={suggestion} />}</For>
          </datalist>
        </label>
      </div>

      <AssessmentDefinitionNotice
        definition={props.definition}
        open={methodologyOpen()}
        onOpenChange={setMethodologyOpen}
      />

      <div class="assessment-progress" aria-live="polite">
        <span class="assessment-progress__label">
          Заполнено {answered()} из {props.definition.questions.length}
        </span>
        <progress
          class="assessment-progress__bar"
          value={answered()}
          max={props.definition.questions.length}
        />
      </div>

      <form
        class="assessment-questionnaire"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <For each={props.definition.questions}>
          {(question, index) => (
            <fieldset
              class="assessment-question paper-card"
              classList={{
                'assessment-question--highlight': highlightedQuestionId() === question.id,
              }}
              data-question-id={question.id}
            >
              <legend
                class="assessment-question__legend"
                classList={{
                  'assessment-question__legend--answered': answers()[question.id] !== undefined,
                }}
              >
                <span
                  class="assessment-question__number"
                  classList={{
                    'assessment-question__number--wide': String(index() + 1).length >= 2,
                  }}
                >
                  {index() + 1}
                </span>
                <strong class="assessment-question__prompt">{question.prompt}</strong>
              </legend>
              <Show
                when={(question.responseOptions ?? props.definition.responseOptions).length > 5}
                fallback={
                  <div
                    class="assessment-response-options"
                    style={`--assessment-option-count: ${(question.responseOptions ?? props.definition.responseOptions).length};`}
                  >
                    <For each={question.responseOptions ?? props.definition.responseOptions}>
                      {(option) => responseOptionLabel(question.id, option)}
                    </For>
                  </div>
                }
              >
                <HorizontalScroller
                  class="assessment-response-options-scroll"
                  viewportClass="assessment-response-options-scroll__viewport"
                  controls
                  hideScrollbar
                  controlLabel="варианты ответов"
                >
                  <div class="assessment-response-options-scroll__row">
                    <For each={question.responseOptions ?? props.definition.responseOptions}>
                      {(option) => responseOptionLabel(question.id, option, true)}
                    </For>
                  </div>
                </HorizontalScroller>
              </Show>
            </fieldset>
          )}
        </For>

        <div class="assessment-submit-panel paper-card">
          <div class="assessment-submit-panel__summary">
            <strong class="assessment-submit-panel__status">
              {complete()
                ? 'Все пункты заполнены'
                : `Осталось ${props.definition.questions.length - answered()} пунктов`}
            </strong>
            <p class="assessment-submit-panel__disclaimer">{props.definition.disclaimer}</p>
          </div>
          <Button
            type="submit"
            class="assessment-submit-panel__button"
            data-testid="assessment-submit"
            disabled={!complete()}
            icon={<AppGlyph name="graph" />}
          >
            Рассчитать
          </Button>
        </div>
      </form>

      <Show when={answered() > 0}>
        <button
          type="button"
          class="assessment-next-button"
          classList={{ 'assessment-next-button--complete': complete() }}
          data-testid="assessment-next"
          aria-label={
            complete()
              ? 'Показать результат'
              : `Следующий вопрос. Осталось ${remaining()} из ${props.definition.questions.length}`
          }
          title={complete() ? 'Показать результат' : 'Следующий вопрос'}
          style={`--assessment-progress: ${(answered() / props.definition.questions.length) * 100}%;`}
          onClick={() => (complete() ? submit() : scrollToNextQuestion())}
        >
          <Show
            when={complete()}
            fallback={<NumberFlow value={remaining()} class="assessment-next-button__count" />}
          >
            <AppGlyph
              name="graph"
              class="assessment-next-button__icon assessment-next-button__icon--complete"
            />
          </Show>
        </button>
      </Show>
    </div>
  );
}
