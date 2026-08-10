import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { SearchField } from '@/components/SearchField';
import { AssessmentCard } from '@/features/assessments/AssessmentCatalogPage';
import {
  ASSESSMENT_SPECIALTIES,
  assessmentsInSpecialty,
  findAssessmentById,
  type searchAssessments,
} from '@/features/assessments/assessment-catalog';
import {
  type AssessmentInstallationState,
  assessmentRequiredByModules,
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

export function AssessmentSpecialtyIndexPage(props: {
  readonly definitions: ReturnType<typeof searchAssessments>;
  readonly matches: ReturnType<typeof searchAssessments>;
  readonly installation: AssessmentInstallationState;
  readonly query: string;
  readonly recentRecords: readonly AssessmentRecord[];
  readonly onQuery: (value: string) => void;
  readonly onOpenSpecialty: (specialtyId: string) => void;
  readonly onOpen: (definition: ReturnType<typeof searchAssessments>[number]) => void;
  readonly onOpenRecord: (
    definition: ReturnType<typeof searchAssessments>[number],
    record: AssessmentRecord,
  ) => void;
  readonly onInstall: (definition: ReturnType<typeof searchAssessments>[number]) => void;
  readonly onRemove: (definition: ReturnType<typeof searchAssessments>[number]) => void;
  readonly onPrint: (definition: ReturnType<typeof searchAssessments>[number]) => void;
}): JSX.Element {
  const installed = (id: string): boolean => props.installation.installedIds.has(id);
  const hasQuery = () => props.query.trim().length > 0;

  return (
    <>
      <header class="subpage-heading assessments-heading">
        <div class="assessment-subpage-header__content">
          <p class="archive-kicker">Тесты и опросники</p>
          <div class="tool-page-title">
            <AppGlyph name="list-checks" />
            <h1>Тесты и опросники</h1>
          </div>
          <p class="assessments-heading__description">
            Выберите раздел медицины, скачайте нужные тесты на устройство и проходите их без сети.
            Результаты сохраняются локально и не отправляются в интернет.
          </p>
        </div>
      </header>

      <SearchField
        class="assessment-search"
        value={props.query}
        placeholder="Например: Белбин, темперамент, эгограмма"
        label="Найти тест"
        hideLabel
        onInput={props.onQuery}
      />

      <Show
        when={hasQuery()}
        fallback={
          <div class="assessment-specialty-grid">
            <For each={ASSESSMENT_SPECIALTIES}>
              {(specialty) => {
                const specialtyDefinitions = () =>
                  assessmentsInSpecialty(specialty.id, props.definitions);
                const installedCount = () =>
                  specialtyDefinitions().filter((definition) => installed(definition.id)).length;
                const empty = () => specialtyDefinitions().length === 0;
                return (
                  <button
                    type="button"
                    class="assessment-specialty-card paper-card"
                    classList={{ 'assessment-specialty-card--empty': empty() }}
                    disabled={empty()}
                    data-testid={`assessment-specialty-${specialty.id}`}
                    onClick={() => props.onOpenSpecialty(specialty.id)}
                  >
                    <p class="archive-kicker assessment-specialty-card__kicker">Раздел тестов</p>
                    <h2 class="assessment-specialty-card__title">{specialty.title}</h2>
                    <p class="assessment-specialty-card__description">{specialty.description}</p>
                    <small class="assessment-specialty-card__meta">
                      {empty()
                        ? 'Тесты появятся позже'
                        : `${installedCount()}/${specialtyDefinitions().length} тестов на устройстве`}
                    </small>
                  </button>
                );
              }}
            </For>
          </div>
        }
      >
        <Show when={props.matches.length > 0} fallback={<p>По этому запросу ничего не найдено.</p>}>
          <div class="assessment-catalog-grid">
            <For each={props.matches}>
              {(definition) => {
                const requiredModules = () =>
                  assessmentRequiredByModules(definition.id, props.installation);
                const hasUserManagedSource = () =>
                  props.installation.manualIds.has(definition.id) ||
                  (props.installation.sectionIds.has(definition.category) &&
                    !props.installation.excludedIds.has(definition.id));
                return (
                  <AssessmentCard
                    definition={definition}
                    installed={installed(definition.id)}
                    canDelete={hasUserManagedSource()}
                    requiredModules={requiredModules()}
                    onOpen={props.onOpen}
                    onInstall={props.onInstall}
                    onRemove={props.onRemove}
                    onPrint={props.onPrint}
                  />
                );
              }}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={props.recentRecords.length > 0}>
        <section class="assessment-history">
          <header class="assessment-history__header">
            <p class="archive-kicker">Локальная история</p>
            <h2 class="assessment-history__heading">Последние результаты</h2>
          </header>
          <div class="assessment-history-list">
            <For each={props.recentRecords}>
              {(record) => {
                const definition = () => findAssessmentById(record.assessmentId);
                return (
                  <Show when={definition()}>
                    {(resolved) => (
                      <button
                        class="assessment-history__entry"
                        type="button"
                        onClick={() => props.onOpenRecord(resolved(), record)}
                      >
                        <span class="assessment-history__title">{resolved().shortTitle}</span>
                        <strong class="assessment-history__subject">
                          {record.subjectLabel || 'Без подписи'} · {formatDate(record.createdAt)}
                        </strong>
                        <small class="assessment-history__summary">
                          {record.kind === 'completed' && record.result.headline}
                          {record.kind === 'manual' && 'Результат внесён вручную'}
                          {record.kind === 'incomplete' && (
                            <>
                              <span class="assessment-history__tag">incomplete</span>{' '}
                              <span class="assessment-history__count">
                                {Object.keys(record.answers).length}/{record.totalQuestions}{' '}
                                отвечено
                              </span>
                            </>
                          )}
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
