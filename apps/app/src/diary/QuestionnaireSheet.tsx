import { createResource, createSignal, For, type JSX, Show } from 'solid-js';

import { Button } from '@/components/Button';
import type { CareSave } from '@/diary/care-sheets';
import { DiarySheet } from '@/diary/DiarySheet';
import { DiarySkeleton } from '@/diary/diary-ui';
import { scoreAssessment } from '@/features/assessments/assessment-engine';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';
import { atTime, dayKey } from '@/features/diary/diary-care';
import { createDiaryId, type DiaryCheckpoint, type DiaryEntry } from '@/features/diary/diary-model';
import { loadCheckpointQuestionnaire } from '@/features/diary/diary-questionnaires';

function optionsFor(definition: AssessmentDefinition, questionId: string) {
  const question = definition.questions.find((candidate) => candidate.id === questionId);
  return question?.responseOptions ?? definition.responseOptions;
}

/**
 * A self-report questionnaire, one card per question. The patient sees no score: the doctor reads
 * it. When the answers raise an alert of the questionnaire's schema (PHQ-9 item 9), the crisis
 * screen opens after saving.
 */
export function QuestionnaireSheet(props: {
  readonly day: string;
  readonly checkpoint: DiaryCheckpoint;
  readonly entry: DiaryEntry | undefined;
  readonly onSave: CareSave;
  readonly onAlert: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  const [definition] = createResource(
    () => props.checkpoint,
    (checkpoint) => loadCheckpointQuestionnaire(checkpoint),
  );
  const [answers, setAnswers] = createSignal<Record<string, number>>({
    ...(props.entry?.answers ?? {}),
  });
  const [error, setError] = createSignal('');

  const answered = (): number => Object.keys(answers()).length;
  const total = (): number => definition()?.questions.length ?? 0;

  const save = (): void => {
    const current = definition();
    if (!current) return;
    const missing = current.questions.find((question) => answers()[question.id] === undefined);
    if (missing) {
      setError('Ответьте на все вопросы.');
      document.getElementById(`question-${missing.id}`)?.scrollIntoView({ block: 'center' });
      return;
    }
    const scored = scoreAssessment(current, answers());
    if (!scored.ok) {
      setError(scored.error);
      return;
    }
    const today = props.day === dayKey(new Date());
    const problem = props.onSave({
      id: props.entry?.id ?? createDiaryId(),
      at: props.entry?.at ?? (today ? new Date().toISOString() : atTime(props.day, '12:00')),
      check: props.checkpoint.id,
      values: {},
      answers: answers(),
    });
    if (problem) {
      setError(problem);
      return;
    }
    if (scored.value.alerts?.length) props.onAlert();
  };

  return (
    <DiarySheet
      title={definition()?.shortTitle ?? props.checkpoint.label}
      subtitle={definition() ? `Отвечено ${answered()} из ${total()}` : 'Загружаем вопросы…'}
      tall
      onClose={props.onClose}
      footer={
        <>
          <Show when={error()}>
            <p class="diary-care-error" role="alert">
              {error()}
            </p>
          </Show>
          <div class="diary-care-actions">
            <Button
              class="diary-button diary-care-actions__save"
              variant="primary"
              disabled={!definition()}
              onClick={save}
            >
              Готово
            </Button>
          </div>
        </>
      }
    >
      <Show when={definition.error}>
        <p class="diary-care-error" role="alert">
          Не удалось открыть опросник. Обновите страницу.
        </p>
      </Show>
      <Show when={definition()} fallback={<DiarySkeleton label="Загружаем вопросы" lines={6} />}>
        {(current) => (
          <ol class="diary-quiz">
            <For each={current().questions}>
              {(question, index) => (
                <li class="diary-quiz__question" id={`question-${question.id}`}>
                  <fieldset class="diary-quiz__fieldset">
                    <legend class="diary-quiz__prompt">
                      <span class="diary-quiz__number">{index() + 1}.</span> {question.prompt}
                    </legend>
                    <div class="diary-quiz__options">
                      <For each={optionsFor(current(), question.id)}>
                        {(option) => (
                          <button
                            type="button"
                            class="diary-quiz__option"
                            classList={{
                              'diary-quiz__option--on': answers()[question.id] === option.value,
                            }}
                            aria-pressed={answers()[question.id] === option.value}
                            onClick={() => {
                              setError('');
                              setAnswers((currentAnswers) => ({
                                ...currentAnswers,
                                [question.id]: option.value,
                              }));
                            }}
                          >
                            {option.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </fieldset>
                </li>
              )}
            </For>
          </ol>
        )}
      </Show>
    </DiarySheet>
  );
}
