import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { Heading } from '@/components/Text';
import { AssessmentDefinitionNotice } from '@/features/assessments/AssessmentDefinitionNotice';
import {
  printBlankAssessment,
  printExternalAssessmentMaterial,
} from '@/features/assessments/assessment-print';
import { assessmentWorkspaceCrumbs } from '@/features/assessments/assessment-routing';
import type {
  AssessmentDefinition,
  AssessmentRecord,
} from '@/features/assessments/assessment-types';
import {
  isAcceptedExternalAssessmentMaterial,
  parseExternalAssessmentValues,
} from '@/features/assessments/external-assessment';
import { createExternalAssessmentRecord } from '@/state/assessment-results';

export function ExternalAssessmentPage(props: {
  readonly definition: AssessmentDefinition;
  readonly onBack: () => void;
  readonly onSaved: (record: AssessmentRecord) => void;
  readonly onMessage: (message: string) => void;
}): JSX.Element {
  const administration = () => props.definition.externalAdministration;
  const firstVariantId = administration()?.variants[0]?.id ?? '';
  const [variantId, setVariantId] = createSignal(firstVariantId);
  const [subjectLabel, setSubjectLabel] = createSignal('');
  const [values, setValues] = createSignal<Record<string, string>>({});
  const [material, setMaterial] = createSignal<File>();
  const [methodologyOpen, setMethodologyOpen] = createSignal(false);
  const [materialBusy, setMaterialBusy] = createSignal(false);
  let materialInput: HTMLInputElement | undefined;

  const variant = createMemo(() => {
    const current = administration();
    return current?.variants.find((item) => item.id === variantId()) ?? current?.variants[0];
  });
  const acceptedMimeTypes = () => administration()?.material.acceptedMimeTypes.join(',') ?? '';

  const save = (): void => {
    const selected = variant();
    if (!selected) {
      props.onMessage('Вариант методики не выбран.');
      return;
    }
    const parsed = parseExternalAssessmentValues(selected, values());
    if (!parsed.ok) {
      props.onMessage(parsed.error);
      return;
    }
    const record = createExternalAssessmentRecord({
      assessmentId: props.definition.id,
      subjectLabel: subjectLabel(),
      variantId: selected.id,
      values: parsed.values,
      ...(props.definition.version ? { definitionVersion: props.definition.version } : {}),
    });
    props.onSaved(record);
  };

  const printMaterial = async (): Promise<void> => {
    const file = material();
    const selected = variant();
    if (!file || !selected || materialBusy()) return;
    setMaterialBusy(true);
    try {
      const printed = await printExternalAssessmentMaterial(
        file,
        `${props.definition.shortTitle} — ${selected.shortLabel}`,
      );
      props.onMessage(
        printed ? 'Материал передан на печать.' : 'Не удалось открыть локальный материал для печати.',
      );
    } catch (cause) {
      props.onMessage(
        cause instanceof Error ? cause.message : 'Не удалось подготовить локальный материал.',
      );
    } finally {
      setMaterialBusy(false);
    }
  };

  const printResultSheet = (): void => {
    props.onMessage(
      printBlankAssessment(props.definition)
        ? 'Лист результата подготовлен к печати.'
        : 'Не удалось открыть окно печати.',
    );
  };

  return (
    <article class="assessment-external-page">
      <Page
        class="assessment-page-header assessment-external-page__header"
        navigation={
          <NavBack class="knowledge-back-button" aria-label="К тестам" onClick={props.onBack} />
        }
        breadcrumbs={<AppBreadcrumbs items={assessmentWorkspaceCrumbs(props.definition)} />}
        icon={<AppGlyph name="list-checks" class="page__icon-glyph" />}
        title={
          <Heading depth={3} class="assessment-subpage-title">
            {props.definition.title}
          </Heading>
        }
        actions={
          <div class="assessment-subpage-header-actions assessment-subpage-header-actions--trailing">
            <Button
              type="button"
              variant="icon"
              class="knowledge-back-button"
              aria-label="Распечатать лист результата"
              title="Распечатать лист результата"
              onClick={printResultSheet}
              icon={<AppGlyph name="printer" />}
            />
            <Button
              type="button"
              variant="icon"
              class="knowledge-back-button assessment-help-button"
              aria-label="О методике и источниках"
              title="О методике и источниках"
              onClick={() => setMethodologyOpen(true)}
              icon={<AppGlyph name="question" class="assessment-help-button__icon" />}
            />
          </div>
        }
      />

      <section class="assessment-external-card paper-card">
        <p class="assessment-external-card__lead">
          Результат вносится по внешнему бланку. MiniMed не показывает защищённые задания и не
          пересчитывает нормы этой методики.
        </p>

        <label class="assessment-external-field">
          <span class="assessment-external-field__label">Пациент / подпись</span>
          <input
            class="assessment-external-field__control"
            value={subjectLabel()}
            placeholder="Необязательно"
            onInput={(event) => setSubjectLabel(event.currentTarget.value)}
          />
        </label>

        <Show when={(administration()?.variants.length ?? 0) > 1}>
          <label class="assessment-external-field">
            <span class="assessment-external-field__label">Вариант методики</span>
            <select
              class="assessment-external-field__control"
              value={variantId()}
              onChange={(event) => {
                setVariantId(event.currentTarget.value);
                setValues({});
                setMaterial(undefined);
              }}
            >
              <For each={administration()?.variants ?? []}>
                {(item) => <option value={item.id}>{item.label}</option>}
              </For>
            </select>
          </label>
        </Show>

        <Show when={variant()}>
          {(selected) => (
            <>
              <div class="assessment-external-variant">
                <strong>{selected().label}</strong>
                <p>{selected().description}</p>
                <small>{selected().audience}</small>
              </div>

              <div class="assessment-external-fields">
                <For each={selected().resultFields}>
                  {(field) => (
                    <label class="assessment-external-field">
                      <span class="assessment-external-field__label">
                        {field.label}
                        <Show when={field.kind === 'number' && field.unit}>
                          {(unit) => <> · {unit()}</>}
                        </Show>
                      </span>
                      <Show
                        when={field.kind === 'select' ? field : undefined}
                        fallback={
                          field.kind === 'text' && field.multiline ? (
                            <textarea
                              class="assessment-external-field__control assessment-external-field__control--textarea"
                              value={values()[field.id] ?? ''}
                              placeholder={field.kind === 'text' ? field.placeholder : undefined}
                              onInput={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [field.id]: event.currentTarget.value,
                                }))
                              }
                            />
                          ) : (
                            <input
                              class="assessment-external-field__control"
                              type={field.kind === 'number' ? 'number' : 'text'}
                              value={values()[field.id] ?? ''}
                              min={field.kind === 'number' ? field.minimum : undefined}
                              max={field.kind === 'number' ? field.maximum : undefined}
                              step={field.kind === 'number' && field.integer ? 1 : 'any'}
                              placeholder={field.kind === 'text' ? field.placeholder : undefined}
                              onInput={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [field.id]: event.currentTarget.value,
                                }))
                              }
                            />
                          )
                        }
                      >
                        {(selectField) => (
                          <select
                            class="assessment-external-field__control"
                            value={values()[selectField().id] ?? ''}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [selectField().id]: event.currentTarget.value,
                              }))
                            }
                          >
                            <option value="">Выберите…</option>
                            <For each={selectField().options}>
                              {(option) => <option value={option.value}>{option.label}</option>}
                            </For>
                          </select>
                        )}
                      </Show>
                    </label>
                  )}
                </For>
              </div>
            </>
          )}
        </Show>

        <div class="assessment-external-material">
          <strong>Стимульный материал / бланк</strong>
          <p>{administration()?.material.note}</p>
          <input
            ref={materialInput}
            class="assessment-external-material__input"
            type="file"
            accept={acceptedMimeTypes()}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              if (
                !isAcceptedExternalAssessmentMaterial(
                  file,
                  administration()?.material.acceptedMimeTypes ?? [],
                )
              ) {
                props.onMessage('Выбран неподдерживаемый тип файла.');
                event.currentTarget.value = '';
                return;
              }
              setMaterial(file);
            }}
          />
          <div class="assessment-external-material__actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => materialInput?.click()}
              icon={<AppGlyph name="file-arrow-down" />}
            >
              {material() ? 'Заменить локальный файл' : 'Выбрать локальный файл'}
            </Button>
            <Show when={material()}>
              {(file) => (
                <>
                  <span class="assessment-external-material__name">{file().name}</span>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={materialBusy()}
                    onClick={() => void printMaterial()}
                    icon={<AppGlyph name="printer" />}
                  >
                    {materialBusy() ? 'Подготавливаем…' : 'Печатать тест'}
                  </Button>
                </>
              )}
            </Show>
          </div>
        </div>

        <div class="assessment-external-actions">
          <Button
            type="button"
            variant="primary"
            onClick={save}
            icon={<AppGlyph name="check" />}
          >
            Сохранить результат
          </Button>
        </div>
      </section>

      <AssessmentDefinitionNotice
        definition={props.definition}
        open={methodologyOpen()}
        showTrigger={false}
        onOpenChange={setMethodologyOpen}
      />
    </article>
  );
}
