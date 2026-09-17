import { isHttpUrl } from '@localmed/contracts';
import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';

export function AssessmentDefinitionNotice(props: {
  readonly definition: AssessmentDefinition;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly showTrigger?: boolean;
}): JSX.Element {
  const safeLicenseSourceUrl = (): string | undefined => {
    const url = props.definition.license.sourceUrl;
    return url && isHttpUrl(url) ? url : undefined;
  };
  return (
    <>
      <Show when={props.showTrigger !== false}>
        <Button
          type="button"
          variant="icon"
          class="knowledge-back-button assessment-help-button"
          aria-label="Методика и ограничения"
          aria-haspopup="dialog"
          aria-expanded={props.open}
          title="О шкале и источниках"
          onClick={() => props.onOpenChange(true)}
          icon={<AppGlyph name="question" class="assessment-help-button__icon" />}
        />
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
            <strong class="assessment-methodology-body__label">Что описывает и как читать</strong>
            <ul class="assessment-methodology-body__scale-list">
              <For each={props.definition.scales}>
                {(scale) => (
                  <li class="assessment-methodology-body__scale-item">
                    <strong class="assessment-methodology-body__label">{scale.label}:</strong>{' '}
                    {scale.description}
                  </li>
                )}
              </For>
            </ul>
            <p class="assessment-methodology-body__text">
              Оценивайте результат по правилам именно этой версии инструмента и в контексте
              обследования. Баллы разных шкал не взаимозаменяемы; результат не устанавливает диагноз.
            </p>
          </div>
          <p class="assessment-methodology-body__text">{props.definition.disclaimer}</p>
          <p class="assessment-methodology-body__text">
            <strong class="assessment-methodology-body__label">Источник и статус:</strong>{' '}
            {props.definition.license.notice}
          </p>
          <Show when={safeLicenseSourceUrl()}>
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
              <strong class="assessment-methodology-body__label">Связанные источники</strong>
              <ul class="assessment-methodology-body__source-list">
                <For each={props.definition.sourceLinks}>
                  {(source) => {
                    const sourceUrl = source.url && isHttpUrl(source.url) ? source.url : undefined;
                    return (
                      <li class="assessment-methodology-body__source-item">
                        <span class="assessment-methodology-body__source-title">{source.title}</span>
                        <Show when={sourceUrl}>
                          {(url) => (
                            <a
                              class="assessment-methodology-body__link"
                              href={url()}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Открыть
                            </a>
                          )}
                        </Show>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </div>
          </Show>
        </div>
      </OverlayDialog>
    </>
  );
}
