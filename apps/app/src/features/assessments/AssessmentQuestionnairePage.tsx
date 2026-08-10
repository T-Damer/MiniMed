import { createEffect, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { AssessmentDefinitionNotice } from '@/features/assessments/AssessmentDefinitionNotice';
import { answeredQuestionCount, scoreAssessment } from '@/features/assessments/assessment-engine';
import { printBlankAssessment } from '@/features/assessments/assessment-print';
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
  let draftId = props.initialRecord?.id;
  const answered = () => answeredQuestionCount(props.definition, answers());
  const complete = () => answered() === props.definition.questions.length;
  const patientSuggestions = () => loadPatientNotes().cards.map((card) => card.title);

  createEffect(() => {
    const showFloatingControls = answered() > 0;
    document
      .querySelector<HTMLElement>('.scroll-top-button')
      ?.classList.toggle('assessment-scroll-top--secondary', showFloatingControls);
    document
      .querySelector<HTMLElement>('.patient-notes-fab')
      ?.classList.toggle('assessment-patient-notes-fab--hidden', showFloatingControls);
  });
  onCleanup(() => {
    document
      .querySelector<HTMLElement>('.scroll-top-button')
      ?.classList.remove('assessment-scroll-top--secondary');
    document
      .querySelector<HTMLElement>('.patient-notes-fab')
      ?.classList.remove('assessment-patient-notes-fab--hidden');
  });

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
    document
      .querySelector<HTMLElement>(
        '.assessment-questionnaire .assessment-question:not(:has(input:checked))',
      )
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div class="assessment-workspace">
      <header class="assessment-subpage-header">
        <div class="assessment-subpage-header-actions assessment-subpage-header-actions--leading">
          <button
            type="button"
            class="knowledge-back-button"
            aria-label="К каталогу тестов"
            onClick={props.onBack}
          >
            <AppGlyph name="arrow-left" />
          </button>
        </div>
        <div class="assessment-subpage-header__content">
          <p class="archive-kicker">{props.sectionTitle} · скачан на устройство</p>
          <h1 class="assessment-subpage-title">{props.definition.title}</h1>
        </div>
        <div class="assessment-subpage-header-actions assessment-subpage-header-actions--trailing">
          <button
            type="button"
            class="knowledge-back-button assessment-print-button"
            aria-label="Распечатать бланк теста"
            title="Распечатать бланк теста"
            onClick={() => printBlankAssessment(props.definition)}
          >
            <AppGlyph name="printer" />
          </button>
          <button
            type="button"
            class="knowledge-back-button assessment-help-button"
            aria-label="Методика и ограничения"
            title="Методика и ограничения"
            onClick={() => setMethodologyOpen(true)}
          >
            <span class="assessment-help-button__label" aria-hidden="true">
              ?
            </span>
          </button>
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
            <fieldset class="assessment-question paper-card">
              <legend
                class="assessment-question__legend"
                classList={{
                  'assessment-question__legend--answered': answers()[question.id] !== undefined,
                }}
              >
                <span class="assessment-question__number">{index() + 1}</span>
                <strong class="assessment-question__prompt">{question.prompt}</strong>
              </legend>
              <div
                class="assessment-response-options"
                classList={{ 'assessment-response-options--has-next': answered() > 0 }}
              >
                <For each={question.responseOptions ?? props.definition.responseOptions}>
                  {(option) => (
                    <label
                      class="assessment-response-options__option"
                      classList={{
                        'assessment-response-options__option--selected':
                          answers()[question.id] === option.value,
                      }}
                    >
                      <input
                        class="assessment-response-options__input"
                        type="radio"
                        name={question.id}
                        value={option.value}
                        checked={answers()[question.id] === option.value}
                        onChange={() => {
                          const nextAnswers = { ...answers(), [question.id]: option.value };
                          setAnswers(nextAnswers);
                          saveDraft(nextAnswers);
                        }}
                      />
                      <span class="assessment-response-options__value">{option.value}</span>
                      <small class="assessment-response-options__label">{option.label}</small>
                    </label>
                  )}
                </For>
              </div>
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
          data-testid="assessment-next"
          aria-label={
            complete()
              ? 'Показать результат'
              : `Следующий вопрос. Заполнено ${answered()} из ${props.definition.questions.length}`
          }
          title={complete() ? 'Показать результат' : 'Следующий вопрос'}
          style={`--assessment-progress: ${(answered() / props.definition.questions.length) * 100}%;`}
          onClick={() => (complete() ? submit() : scrollToNextQuestion())}
        >
          {complete() ? (
            <AppGlyph
              name="graph"
              class="assessment-next-button__icon assessment-next-button__icon--complete"
            />
          ) : (
            <AppGlyph name="arrow-left" class="assessment-next-button__icon" />
          )}
        </button>
      </Show>
    </div>
  );
}
