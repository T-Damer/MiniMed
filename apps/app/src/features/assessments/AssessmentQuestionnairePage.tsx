import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { AssessmentDefinitionNotice } from '@/features/assessments/AssessmentDefinitionNotice';
import {
  answeredQuestionCount,
  scoreAssessment,
} from '@/features/assessments/assessment-engine';
import { printBlankAssessment } from '@/features/assessments/assessment-print';
import type {
  AssessmentDefinition,
  AssessmentRecord,
  AssessmentResponseValue,
} from '@/features/assessments/assessment-types';
import {
  createCompletedAssessmentRecord,
  createManualAssessmentRecord,
} from '@/state/assessment-results';

export function AssessmentQuestionnairePage(props: {
  readonly definition: AssessmentDefinition;
  readonly onBack: () => void;
  readonly onSaved: (record: AssessmentRecord) => void;
  readonly onMessage: (message: string) => void;
}): JSX.Element {
  const [answers, setAnswers] = createSignal<Record<string, AssessmentResponseValue>>({});
  const [subjectLabel, setSubjectLabel] = createSignal('');
  const [manualText, setManualText] = createSignal('');
  const [manualOpen, setManualOpen] = createSignal(false);
  const answered = () => answeredQuestionCount(props.definition, answers());
  const complete = () => answered() === props.definition.questions.length;

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

  const saveManual = (): void => {
    const record = createManualAssessmentRecord({
      assessmentId: props.definition.id,
      subjectLabel: subjectLabel(),
      text: manualText(),
    });
    if (!record) {
      props.onMessage('Введите текст готового результата.');
      return;
    }
    props.onSaved(record);
  };

  return (
    <div class="assessment-workspace">
      <header class="assessment-subpage-header">
        <button
          type="button"
          class="knowledge-back-button"
          aria-label="К каталогу тестов"
          onClick={props.onBack}
        >
          <AppGlyph name="arrow-left" />
        </button>
        <div>
          <p class="archive-kicker">{props.definition.bankLabel}</p>
          <h1>{props.definition.title}</h1>
          <p>{props.definition.description}</p>
        </div>
      </header>

      <div class="assessment-toolbar paper-card">
        <label>
          <span>Пациент / участник — необязательно</span>
          <input
            value={subjectLabel()}
            placeholder="Имя, номер карты или псевдоним"
            onInput={(event) => setSubjectLabel(event.currentTarget.value)}
          />
        </label>
        <div>
          <button type="button" onClick={() => printBlankAssessment(props.definition)}>
            Распечатать / PDF
          </button>
          <button type="button" onClick={() => setManualOpen((value) => !value)}>
            Записать готовый результат
          </button>
        </div>
      </div>

      <Show when={manualOpen()}>
        <section class="assessment-manual-panel paper-card">
          <h2>Результат уже получен вне приложения</h2>
          <p>
            Запишите шкалы, баллы и заключение без пересчёта. В истории будет отмечено,
            что версия внешнего бланка не проверялась.
          </p>
          <textarea
            rows={7}
            value={manualText()}
            placeholder="Название версии, шкалы, баллы, комментарий…"
            onInput={(event) => setManualText(event.currentTarget.value)}
          />
          <div class="assessment-panel-actions">
            <button type="button" onClick={saveManual}>
              Сохранить готовый результат
            </button>
            <button type="button" onClick={() => setManualOpen(false)}>
              Отмена
            </button>
          </div>
        </section>
      </Show>

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
            <fieldset class="assessment-question paper-card">
              <legend>
                <span>{index() + 1}</span>
                {question.prompt}
              </legend>
              <div class="assessment-response-options">
                <For each={props.definition.responseOptions}>
                  {(option) => (
                    <label>
                      <input
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
                      <span>{option.value}</span>
                      <small>{option.label}</small>
                    </label>
                  )}
                </For>
              </div>
            </fieldset>
          )}
        </For>

        <div class="assessment-submit-panel paper-card">
          <div>
            <strong>
              {complete()
                ? 'Все пункты заполнены'
                : `Осталось ${props.definition.questions.length - answered()} пунктов`}
            </strong>
            <p>{props.definition.disclaimer}</p>
          </div>
          <button type="submit" data-testid="assessment-submit" disabled={!complete()}>
            Рассчитать профиль
          </button>
        </div>
      </form>
    </div>
  );
}
