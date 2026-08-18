import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';

export function AssessmentDefinitionNotice(props: {
  readonly definition: AssessmentDefinition;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly showTrigger?: boolean;
}): JSX.Element {
  return (
    <>
      <Show when={props.showTrigger !== false}>
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
      </Show>
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
          <Show when={props.definition.sourceLinks?.length}>
            <div class="assessment-methodology-body__sources">
              <strong>Связанные источники</strong>
              <ul class="assessment-methodology-body__source-list">
                <For each={props.definition.sourceLinks}>
                  {(source) => (
                    <li>
                      <span>{source.title}</span>
                      <Show when={source.url}>
                        {(url) => (
                          <a
                            class="assessment-methodology-body__link"
                            href={url()}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Открыть источник
                          </a>
                        )}
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
        </div>
      </OverlayDialog>
    </>
  );
}
