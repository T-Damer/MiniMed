import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import {
  ASSESSMENT_CATALOG,
  findAssessmentById,
  type searchAssessments,
} from '@/features/assessments/assessment-catalog';
import {
  type AssessmentInstallationState,
  type AssessmentSectionId,
  assessmentIdsInSection,
  assessmentRequiredByModules,
  groupAssessmentsBySection,
} from '@/features/assessments/assessment-packs';
import type { AssessmentRecord } from '@/features/assessments/assessment-types';

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
  readonly installation: AssessmentInstallationState;
  readonly query: string;
  readonly recentRecords: readonly AssessmentRecord[];
  readonly onQuery: (value: string) => void;
  readonly onOpen: (definition: ReturnType<typeof searchAssessments>[number]) => void;
  readonly onOpenRecord: (
    definition: ReturnType<typeof searchAssessments>[number],
    record: AssessmentRecord,
  ) => void;
  readonly onInstall: (definition: ReturnType<typeof searchAssessments>[number]) => void;
  readonly onRemove: (definition: ReturnType<typeof searchAssessments>[number]) => void;
  readonly onPrint: (definition: ReturnType<typeof searchAssessments>[number]) => void;
  readonly onInstallSection: (sectionId: AssessmentSectionId) => void;
  readonly onRemoveSection: (sectionId: AssessmentSectionId) => void;
}): JSX.Element {
  const installed = (id: string): boolean => props.installation.installedIds.has(id);

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
            Подключайте отдельные опросники или тематические разделы, проходите их на устройстве и
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

      <Show
        when={props.definitions.length > 0}
        fallback={<p>По этому запросу ничего не найдено.</p>}
      >
        <div class="assessment-section-list">
          <For each={groupAssessmentsBySection(props.definitions)}>
            {(group) => {
              const sectionAssessmentIds = assessmentIdsInSection(
                group.section.id,
                ASSESSMENT_CATALOG,
              );
              const selected = () => props.installation.sectionIds.has(group.section.id);
              const installedCount = () =>
                sectionAssessmentIds.filter((id) => installed(id)).length;
              const complete = () =>
                selected() &&
                sectionAssessmentIds.every((id) => !props.installation.excludedIds.has(id));
              const actionLabel = () => {
                if (!selected()) return 'Подключить раздел';
                return complete() ? 'Отключить раздел' : 'Восстановить раздел';
              };
              return (
                <section class="assessment-section paper-card">
                  <header class="assessment-section-header">
                    <div>
                      <h2>{group.section.title}</h2>
                      <p>{group.section.description}</p>
                      <small>
                        {installedCount()}/{sectionAssessmentIds.length} подключено
                      </small>
                    </div>
                    <button
                      type="button"
                      data-testid={`assessment-section-${group.section.id}`}
                      onClick={() =>
                        complete()
                          ? props.onRemoveSection(group.section.id)
                          : props.onInstallSection(group.section.id)
                      }
                    >
                      <AppGlyph name={complete() ? 'trash' : 'download'} />
                      <span>{actionLabel()}</span>
                    </button>
                  </header>

                  <div class="assessment-catalog-grid">
                    <For each={group.assessments}>
                      {(definition) => {
                        const requiredModules = () =>
                          assessmentRequiredByModules(definition.id, props.installation);
                        const hasUserManagedSource = () =>
                          props.installation.manualIds.has(definition.id) ||
                          (props.installation.sectionIds.has(definition.category) &&
                            !props.installation.excludedIds.has(definition.id));
                        return (
                          <article
                            class="assessment-card paper-card"
                            classList={{ 'assessment-card-unavailable': !installed(definition.id) }}
                          >
                            <div class="assessment-card-meta">
                              <span>{definition.bankLabel}</span>
                              <span>{definition.estimatedMinutes} мин</span>
                              <Show when={requiredModules().length > 0}>
                                <span title={requiredModules().join(', ')}>
                                  Требуется модулю базы знаний
                                </span>
                              </Show>
                            </div>
                            <h3>{definition.title}</h3>
                            <p>{definition.description}</p>
                            <small>{definition.audience}</small>
                            <div class="assessment-card-actions">
                              <Show
                                when={installed(definition.id)}
                                fallback={
                                  <button
                                    type="button"
                                    data-testid={`assessment-install-${definition.slug}`}
                                    onClick={() => props.onInstall(definition)}
                                  >
                                    <AppGlyph name="download" />
                                    <span>Подключить опросник</span>
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
                                <button type="button" onClick={() => props.onPrint(definition)}>
                                  Распечатать бланк
                                </button>
                                <Show when={hasUserManagedSource()}>
                                  <button
                                    type="button"
                                    aria-label={`Отключить опросник «${definition.shortTitle}»`}
                                    onClick={() => props.onRemove(definition)}
                                  >
                                    <AppGlyph name="trash" />
                                  </button>
                                </Show>
                              </Show>
                            </div>
                          </article>
                        );
                      }}
                    </For>
                  </div>
                </section>
              );
            }}
          </For>
        </div>
      </Show>

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
