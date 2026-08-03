import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import {
  findAssessmentById,
  type searchAssessments,
} from '@/features/assessments/assessment-catalog';
import {
  groupAssessmentsBySection,
  type AssessmentSectionId,
} from '@/features/assessments/assessment-packs';
import { printBlankAssessment } from '@/features/assessments/assessment-print';
import type {
  AssessmentDefinition,
  AssessmentRecord,
} from '@/features/assessments/assessment-types';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function AssessmentCatalogPage(props: {
  readonly definitions: ReturnType<typeof searchAssessments>;
  readonly installedIds: ReadonlySet<string>;
  readonly query: string;
  readonly recentRecords: readonly AssessmentRecord[];
  readonly onQuery: (value: string) => void;
  readonly onOpen: (definition: AssessmentDefinition) => void;
  readonly onOpenRecord: (definition: AssessmentDefinition, record: AssessmentRecord) => void;
  readonly onInstall: (definition: AssessmentDefinition) => void;
  readonly onRemove: (definition: AssessmentDefinition) => void;
  readonly onInstallSection: (sectionId: AssessmentSectionId) => void;
  readonly onRemoveSection: (sectionId: AssessmentSectionId) => void;
}): JSX.Element {
  const installed = (definition: AssessmentDefinition): boolean =>
    props.installedIds.has(definition.id);

  return (
    <>
      <header class="subpage-heading assessments-heading">
        <div>
          <p class="archive-kicker">Психология и психодиагностика</p>
          <div class="tool-page-title">
            <AppGlyph name="list-checks" />
            <h1>Тесты и опросники</h1>
          </div>
          <p>
            Загружайте отдельные опросники или тематические разделы, проходите их на устройстве и
            сохраняйте результаты в карточку.
          </p>
        </div>
      </header>

      <label class="assessment-search">
        <span>Найти тест</span>
        <input
          type="search"
          value={props.query}
          placeholder="Например: Белбин, темперамент, эгограмма"
          onInput={(event) => props.onQuery(event.currentTarget.value)}
        />
      </label>

      <div class="assessment-section-list">
        <For each={groupAssessmentsBySection(props.definitions)}>
          {(group) => {
            const installedCount = () =>
              group.assessments.filter((definition) => installed(definition)).length;
            const complete = () => installedCount() === group.assessments.length;
            return (
              <section class="assessment-section paper-card">
                <header class="assessment-section-header">
                  <div>
                    <h2>{group.section.title}</h2>
                    <p>{group.section.description}</p>
                    <small>
                      {installedCount()}/{group.assessments.length} на устройстве
                    </small>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      complete()
                        ? props.onRemoveSection(group.section.id)
                        : props.onInstallSection(group.section.id)
                    }
                  >
                    <AppGlyph name={complete() ? 'trash' : 'download'} />
                    <span>{complete() ? 'Удалить раздел' : 'Скачать раздел'}</span>
                  </button>
                </header>

                <div class="assessment-catalog-grid">
                  <For each={group.assessments}>
                    {(definition) => (
                      <article
                        class="assessment-card paper-card"
                        classList={{ 'assessment-card-unavailable': !installed(definition) }}
                      >
                        <div class="assessment-card-meta">
                          <span>{definition.bankLabel}</span>
                          <span>{definition.estimatedMinutes} мин</span>
                          <span>{definition.questions.length} пунктов</span>
                        </div>
                        <h3>{definition.title}</h3>
                        <p>{definition.description}</p>
                        <small>{definition.audience}</small>
                        <div class="assessment-card-actions">
                          <Show
                            when={installed(definition)}
                            fallback={
                              <button type="button" onClick={() => props.onInstall(definition)}>
                                <AppGlyph name="download" />
                                <span>Скачать опросник</span>
                              </button>
                            }
                          >
                            <button
                              type="button"
                              data-testid={`assessment-open-${definition.slug}`}
                              onClick={() => props.onOpen(definition)}
                            >
                              Пройти
                            </button>
                            <button type="button" onClick={() => printBlankAssessment(definition)}>
                              Распечатать бланк
                            </button>
                            <button
                              type="button"
                              aria-label={`Удалить опросник «${definition.shortTitle}»`}
                              onClick={() => props.onRemove(definition)}
                            >
                              <AppGlyph name="trash" />
                            </button>
                          </Show>
                        </div>
                      </article>
                    )}
                  </For>
                </div>
              </section>
            );
          }}
        </For>
      </div>

      <Show when={props.recentRecords.length > 0}>
        <section class="assessment-history">
          <header>
            <p class="archive-kicker">Локальная история</p>
            <h2>Последние результаты</h2>
          </header>
          <div class="assessment-history-list">
            <For each={props.recentRecords}>
              {(record) => {
                const definition = () => findAssessmentById(record.assessmentId);
                return (
                  <Show when={definition()}>
                    {(resolved) => (
                      <button type="button" onClick={() => props.onOpenRecord(resolved(), record)}>
                        <span>{resolved().shortTitle}</span>
                        <strong>
                          {record.subjectLabel || 'Без подписи'} · {formatDate(record.createdAt)}
                        </strong>
                        <small>
                          {record.kind === 'completed'
                            ? record.result.headline
                            : 'Результат внесён вручную'}
                        </small>
                      </button>
                    )}
                  </Show>
                );
              }}
            </For>
          </div>
        </section>
      </Show>
    </>
  );
}
