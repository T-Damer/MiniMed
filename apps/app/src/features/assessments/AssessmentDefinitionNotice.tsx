import { isHttpUrl } from '@localmed/contracts';
import { For, type JSX } from 'solid-js';

import { type HelpSource, HelpSources } from '@/components/HelpSources';
import { OverlayDialog } from '@/components/OverlayDialog';
import type { AssessmentDefinition } from '@/features/assessments/assessment-types';

/**
 * A questionnaire's sources for the shared «Источники» list: the primary source page, then the
 * linked КР and articles (a КР the app has opens in the reader).
 */
export function assessmentHelpSources(definition: AssessmentDefinition): readonly HelpSource[] {
  const primaryUrl = definition.license.sourceUrl;
  const primary: HelpSource[] =
    primaryUrl && isHttpUrl(primaryUrl)
      ? [{ title: `${definition.title}: первичный источник`, url: primaryUrl }]
      : [];
  return [
    ...primary,
    ...(definition.sourceLinks ?? []).map(
      (source): HelpSource => ({
        title: source.title,
        ...(source.url && isHttpUrl(source.url) ? { url: source.url } : {}),
        ...(source.documentId
          ? { document: { moduleId: source.moduleId, documentId: source.documentId } }
          : {}),
      }),
    ),
  ];
}

export function AssessmentDefinitionNotice(props: {
  readonly definition: AssessmentDefinition;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): JSX.Element {
  return (
    <OverlayDialog
      open={props.open}
      title="Информация"
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
            Итог показывает относительную выраженность шкал внутри этого опросника. Сравнивайте его
            с описаниями выше и с контекстом ответов; это не диагноз и не замена очной оценке.
          </p>
        </div>
        <p class="assessment-methodology-body__text">{props.definition.disclaimer}</p>
        <p class="assessment-methodology-body__text">
          <strong>Источник и статус:</strong> {props.definition.license.notice}
        </p>
        <HelpSources sources={assessmentHelpSources(props.definition)} />
      </div>
    </OverlayDialog>
  );
}
