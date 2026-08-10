import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';

export function AssessmentDefinitionNotice(props: {
  readonly definition: AssessmentDefinition;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <>
      <button
        type="button"
        class="assessment-methodology-trigger"
        aria-haspopup="dialog"
        onClick={() => props.onOpenChange(true)}
      >
        <span class="assessment-methodology-trigger__icon" aria-hidden="true">
          <AppGlyph name="list" class="assessment-methodology-trigger__glyph" />
        </span>
        <span class="assessment-methodology-trigger__content">
          <strong class="assessment-methodology-trigger__label">Методика и ограничения</strong>
          <small class="assessment-methodology-trigger__hint">
            О подходе, источниках и правовом статусе
          </small>
        </span>
      </button>
      <OverlayDialog
        open={props.open}
        title="Методика и ограничения"
        class="assessment-methodology-dialog"
        onClose={() => props.onOpenChange(false)}
      >
        <div class="assessment-methodology-body">
          <p class="assessment-methodology-body__text assessment-methodology-body__description">
            {props.definition.description}
          </p>
          <p class="assessment-methodology-body__text">{props.definition.evidenceNote}</p>
          <div class="assessment-methodology-body__scales">
            <strong>Что описывает и как читать</strong>
            <ul class="assessment-methodology-body__scale-list">
              <For each={props.definition.scales}>
                {(scale) => (
                  <li>
                    <strong>{scale.label}:</strong> {scale.description}
                  </li>
                )}
              </For>
            </ul>
            <p class="assessment-methodology-body__text">
              Итог показывает относительную выраженность шкал внутри этого опросника. Сравнивайте
              его с описаниями выше и с контекстом ответов; это не диагноз и не замена очной оценке.
            </p>
          </div>
          <p class="assessment-methodology-body__text">{props.definition.disclaimer}</p>
          <p class="assessment-methodology-body__text">
            <strong>Источник и статус:</strong> {props.definition.license.notice}
          </p>
          <Show when={props.definition.license.sourceUrl}>
            {(sourceUrl) => (
              <a
                class="assessment-methodology-body__link"
                href={sourceUrl()}
                target="_blank"
                rel="noreferrer"
              >
                Страница первичного источника
              </a>
            )}
          </Show>
        </div>
      </OverlayDialog>
    </>
  );
}
