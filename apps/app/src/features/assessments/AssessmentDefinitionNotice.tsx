import { type JSX, Show } from 'solid-js';

import type { AssessmentDefinition } from '@/features/assessments/assessment-types';

export function AssessmentDefinitionNotice(props: {
  readonly definition: AssessmentDefinition;
}): JSX.Element {
  return (
    <details class="assessment-methodology paper-card">
      <summary>Методика и ограничения</summary>
      <p>{props.definition.evidenceNote}</p>
      <p>{props.definition.disclaimer}</p>
      <p>
        <strong>Правовой статус:</strong> {props.definition.license.notice}
      </p>
      <Show when={props.definition.license.sourceUrl}>
        {(sourceUrl) => (
          <a href={sourceUrl()} target="_blank" rel="noreferrer">
            Открыть страницу первичного источника
          </a>
        )}
      </Show>
    </details>
  );
}
