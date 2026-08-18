import { For, type JSX, Show } from 'solid-js';

import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { QueryEmptyState } from '@/components/QueryEmptyState';
import { SearchField } from '@/components/SearchField';
import type {
  AssessmentSpecialty,
  searchAssessments,
} from '@/features/assessments/assessment-catalog';
import {
  ASSESSMENT_SECTIONS,
  type AssessmentInstallationState,
  type AssessmentSectionId,
  assessmentRequiredByModules,
  groupAssessmentsBySection,
  isAssessmentSectionComplete,
  isAssessmentSectionFromDatabase,
} from '@/features/assessments/assessment-packs';
import { assessmentCatalogCrumbs } from '@/features/assessments/assessment-routing';

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
        <div class="assessment-card-icon-actions">
          <Show when={!props.installed}>
            <Button
              type="button"
              variant="icon"
              class="assessment-card-icon-button assessment-card-icon-button--download"
              data-testid={`assessment-install-${props.definition.slug}`}
              aria-label={`Скачать «${props.definition.shortTitle}»`}
              title="Скачать"
              onClick={(event) => {
                event.stopPropagation();
                props.onInstall(props.definition);
              }}
              icon={<AppGlyph name="download" class="assessment-card-icon-button__icon" />}
            />
          </Show>
          <Show when={props.installed}>
            <Button
              type="button"
              variant="icon"
              class="assessment-card-icon-button"
              aria-label={`Распечатать бланк «${props.definition.shortTitle}»`}
              title="Распечатать бланк"
              onClick={(event) => {
                event.stopPropagation();
                props.onPrint(props.definition);
              }}
              icon={<AppGlyph name="printer" class="assessment-card-icon-button__icon" />}
            />
            <Show when={props.canDelete}>
              <Button
                type="button"
                variant="icon"
                class="assessment-card-icon-button assessment-card-icon-button-danger"
                aria-label={`Удалить тест «${props.definition.shortTitle}»`}
                title="Удалить тест"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onRemove(props.definition);
                }}
                icon={<AppGlyph name="trash" class="assessment-card-icon-button__icon" />}
              />
            </Show>
          </Show>
        </div>
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
        <NavBack
          class="knowledge-back-button"
          aria-label="К разделам тестов"
          onClick={props.onBack}
        />
        <div class="assessment-subpage-header__content">
          <AppBreadcrumbs
            items={assessmentCatalogCrumbs(
              props.specialty.title,
              props.specialty.id,
              props.sectionId
                ? ASSESSMENT_SECTIONS.find((section) => section.id === props.sectionId)?.title
                : undefined,
            )}
            onNavigate={(href) => {
              window.location.hash = href;
            }}
          />
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

      <Show when={props.definitions.length > 0} fallback={<QueryEmptyState />}>
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
              const fromDatabase = () =>
                isAssessmentSectionFromDatabase(group.section.id, props.definitions);
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
                          {fromDatabase()
                            ? `${sectionAssessmentIds().length} тестов на устройстве`
                            : `${installedCount()}/${sectionAssessmentIds().length} тестов на устройстве · ${
                                complete() ? 'раздел скачан' : 'раздел не скачан'
                              }`}
                        </small>
                      </div>
                      <Show when={!fromDatabase()}>
                        <Button
                          type="button"
                          class="assessment-section-header__button"
                          classList={{
                            'assessment-section-header__button--primary': !complete(),
                            'assessment-section-header__button--danger': complete(),
                          }}
                          data-testid={`assessment-section-${group.section.id}`}
                          onClick={() =>
                            complete()
                              ? props.onRemoveSection(group.section.id)
                              : props.onInstallSection(group.section.id)
                          }
                          icon={
                            <AppGlyph
                              name={complete() ? 'trash' : 'download'}
                              class="assessment-section-header__icon"
                            />
                          }
                        >
                          {complete() ? 'Удалить' : 'Скачать'}
                        </Button>
                      </Show>
                    </header>

                    <Show when={props.sectionId === group.section.id}>
                      <div class="assessment-catalog-grid">
                        <For each={group.assessments}>
                          {(definition) => {
                            const requiredModules = () =>
                              assessmentRequiredByModules(definition.id, props.installation);
                            const hasUserManagedSource = () =>
                              !fromDatabase() &&
                              (props.installation.manualIds.has(definition.id) ||
                                (props.installation.sectionIds.has(definition.category) &&
                                  !props.installation.excludedIds.has(definition.id)));
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
