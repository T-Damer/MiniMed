import { For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { SearchField } from '@/components/SearchField';
import type {
  AssessmentSpecialty,
  searchAssessments,
} from '@/features/assessments/assessment-catalog';
import {
  type AssessmentInstallationState,
  type AssessmentSectionId,
  assessmentRequiredByModules,
  groupAssessmentsBySection,
  isAssessmentSectionComplete,
} from '@/features/assessments/assessment-packs';

export type AssessmentCatalogEntry = ReturnType<typeof searchAssessments>[number];

export function AssessmentCard(props: {
  readonly definition: AssessmentCatalogEntry;
  readonly installed: boolean;
  readonly canDelete: boolean;
  readonly requiredModules: readonly string[];
  readonly onOpen: (definition: AssessmentCatalogEntry) => void;
  readonly onInstall: (definition: AssessmentCatalogEntry) => void;
  readonly onRemove: (definition: AssessmentCatalogEntry) => void;
  readonly onPrint: (definition: AssessmentCatalogEntry) => void;
}): JSX.Element {
  return (
    <article
      class="assessment-card paper-card"
      classList={{ 'assessment-card-unavailable': !props.installed }}
    >
      <Show when={props.installed}>
        <button
          type="button"
          class="assessment-card-open-hit-area"
          aria-label={`Открыть тест «${props.definition.title}»`}
          data-testid={`assessment-open-${props.definition.slug}`}
          onClick={() => props.onOpen(props.definition)}
        />
      </Show>
      <div class="assessment-card-topline">
        <div class="assessment-card-meta">
          <span class="assessment-card-meta__item">{props.definition.bankLabel}</span>
          <span class="assessment-card-meta__item">{props.definition.estimatedMinutes} мин</span>
          <span class="assessment-card-meta__item">
            {props.installed ? 'На устройстве' : 'После скачивания'}
          </span>
          <Show when={props.requiredModules.length > 0}>
            <span class="assessment-card-meta__item" title={props.requiredModules.join(', ')}>
              Требуется модулю базы знаний
            </span>
          </Show>
        </div>
        <Show when={props.installed}>
          <div class="assessment-card-icon-actions">
            <button
              type="button"
              class="assessment-card-icon-button"
              aria-label={`Распечатать бланк «${props.definition.shortTitle}»`}
              title="Распечатать бланк"
              onClick={() => props.onPrint(props.definition)}
            >
              <AppGlyph name="printer" class="assessment-card-icon-button__icon" />
            </button>
            <Show when={props.canDelete}>
              <button
                type="button"
                class="assessment-card-icon-button assessment-card-icon-button-danger"
                aria-label={`Удалить тест «${props.definition.shortTitle}»`}
                title="Удалить тест"
                onClick={() => props.onRemove(props.definition)}
              >
                <AppGlyph name="trash" class="assessment-card-icon-button__icon" />
              </button>
            </Show>
          </div>
        </Show>
        <Show when={!props.installed}>
          <div class="assessment-card-actions">
            <button
              type="button"
              class="assessment-card-actions__button assessment-card-actions__button--primary"
              data-testid={`assessment-install-${props.definition.slug}`}
              onClick={() => props.onInstall(props.definition)}
            >
              <AppGlyph name="download" class="assessment-card-action__icon" />
              <span>Скачать</span>
            </button>
          </div>
        </Show>
      </div>
      <h3 class="assessment-card__title">{props.definition.title}</h3>
      <p class="assessment-card__description">{props.definition.description}</p>
      <small class="assessment-card__audience">{props.definition.audience}</small>
    </article>
  );
}

export function AssessmentCatalogPage(props: {
  readonly specialty: AssessmentSpecialty;
  readonly sectionId?: AssessmentSectionId;
  readonly definitions: ReturnType<typeof searchAssessments>;
  readonly installation: AssessmentInstallationState;
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly onBack: () => void;
  readonly onOpen: (definition: ReturnType<typeof searchAssessments>[number]) => void;
  readonly onInstall: (definition: ReturnType<typeof searchAssessments>[number]) => void;
  readonly onRemove: (definition: ReturnType<typeof searchAssessments>[number]) => void;
  readonly onPrint: (definition: ReturnType<typeof searchAssessments>[number]) => void;
  readonly onOpenSection: (sectionId: AssessmentSectionId) => void;
  readonly onInstallSection: (sectionId: AssessmentSectionId) => void;
  readonly onRemoveSection: (sectionId: AssessmentSectionId) => void;
}): JSX.Element {
  const installed = (id: string): boolean => props.installation.installedIds.has(id);

  return (
    <>
      <header class="subpage-heading assessments-heading assessment-specialty-heading">
        <button
          type="button"
          class="knowledge-back-button"
          aria-label="К разделам тестов"
          onClick={props.onBack}
        >
          <AppGlyph name="arrow-left" />
        </button>
        <div class="assessment-subpage-header__content">
          <p class="archive-kicker">Раздел тестов</p>
          <div class="tool-page-title">
            <AppGlyph name="list-checks" />
            <h1>{props.specialty.title}</h1>
          </div>
          <p class="assessments-heading__description">{props.specialty.description}</p>
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
        when={props.definitions.length > 0}
        fallback={<p>По этому запросу ничего не найдено.</p>}
      >
        <div class="assessment-section-list">
          <For each={groupAssessmentsBySection(props.definitions)}>
            {(group) => {
              const sectionAssessmentIds = () =>
                group.assessments.map((definition) => definition.id);
              const installedCount = () =>
                sectionAssessmentIds().filter((id) => installed(id)).length;
              const complete = () =>
                isAssessmentSectionComplete(
                  group.section.id,
                  props.installation,
                  props.definitions,
                );
              return (
                <Show when={!props.sectionId || props.sectionId === group.section.id}>
                  <section
                    class="assessment-section paper-card"
                    classList={{ 'assessment-section--link': !props.sectionId }}
                    role={props.sectionId ? undefined : 'button'}
                    tabindex={props.sectionId ? undefined : 0}
                    aria-label={
                      props.sectionId ? undefined : `Открыть раздел «${group.section.title}»`
                    }
                    onClick={(event) => {
                      if (props.sectionId) return;
                      if (event.target instanceof Element && event.target.closest('button')) return;
                      props.onOpenSection(group.section.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.target instanceof Element && event.target.closest('button')) return;
                      if (!props.sectionId && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        props.onOpenSection(group.section.id);
                      }
                    }}
                  >
                    <header class="assessment-section-header">
                      <div class="assessment-section-header__content">
                        <h2 class="assessment-section-header__title">{group.section.title}</h2>
                        <p class="assessment-section-header__description">
                          {group.section.description}
                        </p>
                        <small class="assessment-section-header__meta">
                          {installedCount()}/{sectionAssessmentIds().length} тестов на устройстве ·{' '}
                          {complete() ? 'раздел скачан' : 'раздел не скачан'}
                        </small>
                      </div>
                      <button
                        type="button"
                        class="assessment-section-header__button assessment-section-header__button--primary"
                        data-testid={`assessment-section-${group.section.id}`}
                        onClick={() =>
                          complete()
                            ? props.onRemoveSection(group.section.id)
                            : props.onInstallSection(group.section.id)
                        }
                      >
                        <AppGlyph
                          name={complete() ? 'trash' : 'download'}
                          class="assessment-section-header__icon"
                        />
                        <span>{complete() ? 'Удалить' : 'Скачать'}</span>
                      </button>
                    </header>

                    <Show when={props.sectionId === group.section.id}>
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
                  </section>
                </Show>
              );
            }}
          </For>
        </div>
      </Show>
    </>
  );
}
