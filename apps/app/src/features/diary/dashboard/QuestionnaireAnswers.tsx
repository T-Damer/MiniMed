import { For, type JSX, Show } from 'solid-js';

import { Disclosure } from '@/components/Disclosure';
import type { QuestionnaireAnswer } from '@/features/diary/dashboard/diary-insights';

/** The whole questionnaire as the patient filled it in: each question and the answer chosen. */
export function QuestionnaireAnswers(props: {
  readonly answers: readonly QuestionnaireAnswer[];
}): JSX.Element {
  return (
    <Show when={props.answers.length}>
      <Disclosure
        variant="inline"
        class="diary-answers"
        title={`Все ответы (${props.answers.filter((one) => one.answer !== undefined).length} из ${props.answers.length})`}
      >
        <ol class="diary-answers__list">
          <For each={props.answers}>
            {(line) => (
              <li class="diary-answers__item">
                <span class="diary-answers__prompt">{line.prompt}</span>
                <span
                  class="diary-answers__answer"
                  classList={{ 'diary-answers__answer--none': line.answer === undefined }}
                >
                  {line.answer ?? 'нет ответа'}
                  <Show when={line.points !== undefined}>
                    <span class="diary-answers__points"> · {line.points}</span>
                  </Show>
                </span>
              </li>
            )}
          </For>
        </ol>
      </Disclosure>
    </Show>
  );
}
