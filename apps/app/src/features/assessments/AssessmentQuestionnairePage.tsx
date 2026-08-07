import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { AssessmentDefinitionNotice } from '@/features/assessments/AssessmentDefinitionNotice';
import { answeredQuestionCount, scoreAssessment } from '@/features/assessments/assessment-engine';
import { printBlankAssessment } from '@/features/assessments/assessment-print';
import type {
  AssessmentDefinition,
  AssessmentRecord,
  AssessmentResponseValue,
} from '@/features/assessments/assessment-types';
import { createCompletedAssessmentRecord } from '@/state/assessment-results';
import { loadPatientNotes } from '@/state/patient-notes';

export function AssessmentQuestionnairePage(props: {
  readonly definition: AssessmentDefinition;
  readonly sectionTitle: string;
  readonly onBack: () => void;
  readonly onSaved: (record: AssessmentRecord) => void;
  readonly onMessage: (message: string) => void;
}): JSX.Element {
  const [answers, setAnswers] = createSignal<Record<string, AssessmentResponseValue>>({});
  const [subjectLabel, setSubjectLabel] = createSignal('');
  const answered = () => answeredQuestionCount(props.definition, answers());
  const complete = () => answered() === props.definition.questions.length;
  const patientSuggestions = () => loadPatientNotes().cards.map((card) => card.title);

  const submit = (): void => {
    const result = scoreAssessment(props.definition, answers());
    if (!result.ok) {
      props.onMessage(result.error);
      return;
    }
    props.onSaved(
      createCompletedAssessmentRecord({
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
        <div class="assessment-subpage-header-actions">
          <button
            type="button"
            class="knowledge-back-button"
            aria-label="К каталогу тестов"
            onClick={props.onBack}
          >
            <AppGlyph name="arrow-left" />
          </button>
          <button
            type="button"
            class="knowledge-back-button assessment-print-button"
            aria-label="Распечатать бланк теста"
            title="Распечатать бланк теста"
            onClick={() => printBlankAssessment(props.definition)}
          >
            <AppGlyph name="printer" />
          </button>
        </div>
        <div>
          <p class="archive-kicker">{props.sectionTitle} · скачан на устройство</p>
          <h1 class="assessment-subpage-title">{props.definition.title}</h1>
        </div>
      </header>

      <div class="assessment-toolbar paper-card">
        <label class="assessment-toolbar__field">
          <span class="assessment-toolbar__label">Имя / название — необязательно</span>
          <input
            class="assessment-toolbar__input"
            list="assessment-patient-suggestions"
            value={subjectLabel()}
            placeholder="Имя, номер карты или псевдоним"
            onInput={(event) => setSubjectLabel(event.currentTarget.value)}
          />
          <datalist id="assessment-patient-suggestions">
            <For each={patientSuggestions()}>{(suggestion) => <option value={suggestion} />}</For>
          </datalist>
        </label>
      </div>

      <AssessmentDefinitionNotice definition={props.definition} />

      <div class="assessment-progress" aria-live="polite">
        <span>
          Заполнено {answered()} из {props.definition.questions.length}
        </span>
        <progress value={answered()} max={props.definition.questions.length} />
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
                'assessment-question--unanswered': answers()[question.id] === undefined,
              }}
            >
              <legend class="assessment-question__legend">
                <span class="assessment-question__number">{index() + 1}</span>
                <strong class="assessment-question__prompt">{question.prompt}</strong>
              </legend>
              <div class="assessment-response-options">
                <For each={props.definition.responseOptions}>
                  {(option) => (
                    <label class="assessment-response-options__option">
                      <input
                        class="assessment-response-options__input"
                        type="radio"
                        name={question.id}
                        value={option.value}
                        checked={answers()[question.id] === option.value}
                        onChange={() =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: option.value,
                          }))
                        }
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

      <Show when={answered() > 0 && !complete()}>
        <Button
          type="button"
          variant="icon"
          class="assessment-next-button"
          data-testid="assessment-next"
          aria-label={`Следующий вопрос. Заполнено ${answered()} из ${props.definition.questions.length}`}
          title="Следующий вопрос"
          style={`--assessment-progress: ${(answered() / props.definition.questions.length) * 100}%;`}
          icon={<AppGlyph name="arrow-left" class="assessment-next-button__icon" />}
          onClick={scrollToNextQuestion}
        />
      </Show>
    </div>
  );
}
