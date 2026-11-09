import { createResource, createSignal, Index, type JSX, onCleanup, Show } from 'solid-js';

import { PAGE_HEROES } from '@/app/page-heroes';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { PageSkeleton } from '@/components/PageSkeleton';
import { SelectField } from '@/components/SelectField';
import { Switch } from '@/components/Switch';
import { Heading } from '@/components/Text';
import { TextArea } from '@/components/TextArea';
import { TextField } from '@/components/TextField';
import {
  addWorksheetField,
  addWorksheetSection,
  addWorksheetVariant,
  canAddWorksheetField,
  canAddWorksheetSection,
  moveWorksheetField,
  moveWorksheetSection,
  optionsFromText,
  removeWorksheetField,
  removeWorksheetSection,
  removeWorksheetVariant,
  setWorksheetFieldType,
  updateWorksheetField,
  updateWorksheetSection,
  updateWorksheetVariant,
  type WorksheetFieldPatch,
} from '@/features/worksheets/worksheet-edit';
import {
  isNumericField,
  type UserWorksheet,
  WORKSHEET_FIELD_TYPE_LABEL,
  WORKSHEET_FIELD_TYPES,
  WORKSHEET_GROUP_LABEL,
  WORKSHEET_GROUPS,
  WORKSHEET_LAYOUT_LABEL,
  WORKSHEET_LAYOUTS,
  type WorksheetField,
  type WorksheetFieldType,
  type WorksheetGroup,
  type WorksheetLayout,
} from '@/state/user-worksheet-format';
import { loadUserWorksheet, saveUserWorksheet } from '@/state/user-worksheets';

import '@/features/worksheets/worksheets.css';

const AUTOSAVE_MS = 600;

type SaveState = 'saved' | 'saving' | 'error';

function IconButton(props: {
  readonly label: string;
  readonly icon: 'arrow-up' | 'caret-down' | 'trash';
  readonly disabled?: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant="icon"
      class="worksheet-editor__icon"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      icon={<AppGlyph name={props.icon} class="worksheet-editor__icon-glyph" />}
      onClick={props.onClick}
    />
  );
}

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value.replace(',', '.'));
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
}

/** One column of a worksheet in an editor (the library editor, an assignment for one patient). */
export function WorksheetFieldCard(props: {
  readonly field: WorksheetField;
  readonly index: number;
  readonly count: number;
  readonly onChange: (next: (worksheet: UserWorksheet) => UserWorksheet) => void;
}): JSX.Element {
  const id = (): string => props.field.id;
  const patch = (value: WorksheetFieldPatch): void =>
    props.onChange((worksheet) => updateWorksheetField(worksheet, id(), value));
  return (
    <li class="worksheet-editor__card">
      <div class="worksheet-editor__card-head">
        <span class="worksheet-editor__card-number">{props.index + 1}</span>
        <TextField
          class="worksheet-editor__grow"
          label="Название поля"
          value={props.field.label}
          onInput={(event) => patch({ label: event.currentTarget.value })}
        />
        <IconButton
          label="Выше"
          icon="arrow-up"
          disabled={props.index === 0}
          onClick={() => props.onChange((worksheet) => moveWorksheetField(worksheet, id(), -1))}
        />
        <IconButton
          label="Ниже"
          icon="caret-down"
          disabled={props.index === props.count - 1}
          onClick={() => props.onChange((worksheet) => moveWorksheetField(worksheet, id(), 1))}
        />
        <IconButton
          label="Удалить поле"
          icon="trash"
          disabled={props.count === 1}
          onClick={() => props.onChange((worksheet) => removeWorksheetField(worksheet, id()))}
        />
      </div>
      <SelectField
        label="Что вводит пациент"
        value={props.field.type}
        options={WORKSHEET_FIELD_TYPES.map((type) => ({
          value: type,
          label: WORKSHEET_FIELD_TYPE_LABEL[type],
        }))}
        onChange={(event) =>
          props.onChange((worksheet) =>
            setWorksheetFieldType(worksheet, id(), event.currentTarget.value as WorksheetFieldType),
          )
        }
      />
      <Show when={props.field.type === 'choice' || props.field.type === 'multi'}>
        <TextArea
          label="Варианты, по одному в строке"
          value={(props.field.options ?? []).join('\n')}
          rows={3}
          onInput={(event) => patch({ options: optionsFromText(event.currentTarget.value) })}
        />
      </Show>
      <Show when={props.field.type === 'number'}>
        <div class="worksheet-editor__inline">
          <TextField
            label="Единица"
            value={props.field.unit ?? ''}
            onInput={(event) => patch({ unit: event.currentTarget.value.trim() || undefined })}
          />
          <TextField
            label="От"
            inputMode="decimal"
            value={props.field.min?.toString() ?? ''}
            onInput={(event) => patch({ min: numberOrUndefined(event.currentTarget.value) })}
          />
          <TextField
            label="До"
            inputMode="decimal"
            value={props.field.max?.toString() ?? ''}
            onInput={(event) => patch({ max: numberOrUndefined(event.currentTarget.value) })}
          />
        </div>
      </Show>
      <TextArea
        label="Что значит поле — для пациента"
        value={props.field.patientHint}
        rows={2}
        onInput={(event) => patch({ patientHint: event.currentTarget.value })}
      />
      <TextArea
        label="Как читать ответ — для врача"
        value={props.field.doctorHint}
        rows={2}
        onInput={(event) => patch({ doctorHint: event.currentTarget.value })}
      />
      <div class="worksheet-editor__switches">
        <div class="worksheet-editor__switch-row">
          <span class="worksheet-editor__switch-label">Только в расширенной версии</span>
          <Switch
            aria-label="Только в расширенной версии"
            checked={props.field.extended === true}
            onChange={(extended) => patch({ extended: extended ? true : undefined })}
          />
        </div>
        <Show when={isNumericField(props.field.type)}>
          <div class="worksheet-editor__switch-row">
            <span class="worksheet-editor__switch-label">График у врача</span>
            <Switch
              aria-label="График у врача"
              checked={props.field.chart === true}
              onChange={(chart) => patch({ chart: chart ? true : undefined })}
            />
          </div>
        </Show>
      </div>
    </li>
  );
}

/**
 * The editor of a doctor's own worksheet (CBT1), the questionnaire editor's pattern: every change
 * saves itself after a short pause; an invalid state (a choice with one option) is shown, not saved.
 */
export function WorksheetEditor(props: {
  readonly fileId: string;
  readonly onBack: () => void;
}): JSX.Element {
  const [loaded] = createResource(
    () => props.fileId,
    async (fileId) => {
      const stored = await loadUserWorksheet(fileId);
      setDraft(stored.worksheet);
      return stored;
    },
  );
  const [draft, setDraft] = createSignal<UserWorksheet | undefined>();
  const [saveState, setSaveState] = createSignal<SaveState>('saved');
  const [error, setError] = createSignal('');
  let timer: number | undefined;
  let pending: UserWorksheet | undefined;

  const flush = async (): Promise<void> => {
    window.clearTimeout(timer);
    timer = undefined;
    const next = pending;
    pending = undefined;
    if (!next) return;
    try {
      await saveUserWorksheet(props.fileId, next);
      if (!pending) setSaveState('saved');
    } catch (cause) {
      setSaveState('error');
      setError(cause instanceof Error ? cause.message : 'Не удалось сохранить.');
    }
  };
  onCleanup(() => void flush());

  const change = (edit: (worksheet: UserWorksheet) => UserWorksheet): void => {
    const current = draft();
    if (!current) return;
    const next = edit(current);
    setDraft(next);
    pending = next;
    setSaveState('saving');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  };
  const set = (patch: Partial<UserWorksheet>): void =>
    change((worksheet) => ({ ...worksheet, ...patch }) as UserWorksheet);

  const back = (): void => {
    void flush();
    props.onBack();
  };

  return (
    <Show
      when={draft()}
      fallback={
        <Show when={loaded.error} fallback={<PageSkeleton fallbackHash="#/notes/worksheets" />}>
          <main class="worksheet-editor">
            <Page
              navigation={<NavBack aria-label="Назад" onClick={props.onBack} />}
              title={<Heading depth={1}>Дневник не найден</Heading>}
            />
          </main>
        </Show>
      }
    >
      {(current) => (
        <main class="worksheet-editor" aria-label="Редактор дневника">
          <Page
            hero={PAGE_HEROES.library}
            navigation={<NavBack aria-label="Назад" onClick={back} />}
            title={<Heading depth={1}>{current().title.trim() || 'Новый дневник'}</Heading>}
            description={
              <span
                class="worksheet-editor__save-state"
                classList={{ 'worksheet-editor__save-state--error': saveState() === 'error' }}
                role="status"
                data-testid="worksheet-save-state"
              >
                {saveState() === 'saving'
                  ? 'Сохраняем…'
                  : saveState() === 'error'
                    ? error()
                    : 'Все изменения сохранены'}
              </span>
            }
            help={
              <p>
                Изменения сохраняются сами. Поля — это колонки листа: пациент заполняет их на каждый
                случай, час или ступень. Пояснения для пациента печатаются под бланком.
              </p>
            }
          />

          <section class="worksheet-editor__panel" aria-label="Основное">
            <TextField
              label="Название"
              value={current().title}
              onInput={(event) => set({ title: event.currentTarget.value })}
            />
            <TextField
              label="Кратко, одной строкой"
              value={current().summary}
              onInput={(event) => set({ summary: event.currentTarget.value })}
            />
            <div class="worksheet-editor__inline">
              <SelectField
                label="Раздел"
                value={current().group}
                options={WORKSHEET_GROUPS.map((group) => ({
                  value: group,
                  label: WORKSHEET_GROUP_LABEL[group],
                }))}
                onChange={(event) => set({ group: event.currentTarget.value as WorksheetGroup })}
              />
              <SelectField
                label="Как заполняют"
                value={current().layout}
                options={WORKSHEET_LAYOUTS.map((layout) => ({
                  value: layout,
                  label: WORKSHEET_LAYOUT_LABEL[layout],
                }))}
                onChange={(event) => {
                  const layout = event.currentTarget.value as WorksheetLayout;
                  set(
                    layout === 'hours'
                      ? { layout, hours: current().hours ?? { from: 6, to: 24 } }
                      : { layout },
                  );
                }}
              />
            </div>
            <div class="worksheet-editor__inline">
              <TextField
                label={current().layout === 'ladder' ? 'Ступеней на бланке' : 'Строк на бланке'}
                inputMode="numeric"
                value={String(current().rows)}
                onInput={(event) => {
                  const rows = numberOrUndefined(event.currentTarget.value);
                  if (rows !== undefined) set({ rows: Math.round(rows) });
                }}
              />
              <Show when={current().layout === 'hours'}>
                <TextField
                  label="С часа"
                  inputMode="numeric"
                  value={String(current().hours?.from ?? 6)}
                  onInput={(event) => {
                    const from = numberOrUndefined(event.currentTarget.value);
                    if (from !== undefined) set({ hours: { from, to: current().hours?.to ?? 24 } });
                  }}
                />
                <TextField
                  label="До часа"
                  inputMode="numeric"
                  value={String(current().hours?.to ?? 24)}
                  onInput={(event) => {
                    const to = numberOrUndefined(event.currentTarget.value);
                    if (to !== undefined) set({ hours: { from: current().hours?.from ?? 6, to } });
                  }}
                />
              </Show>
            </div>
            <div class="worksheet-editor__switch-row">
              <span class="worksheet-editor__switch-label">Тексты проверены</span>
              <Switch
                aria-label="Тексты проверены"
                checked={!current().draft}
                onChange={(checked) => set({ draft: !checked })}
              />
            </div>
          </section>

          <section class="worksheet-editor__panel" aria-label="Пояснения">
            <TextArea
              label="Для пациента: зачем это и как заполнять"
              value={current().patientNote}
              rows={5}
              onInput={(event) => set({ patientNote: event.currentTarget.value })}
            />
            <TextArea
              label="Для врача: при чём применяют, что даёт, как читать"
              value={current().doctorNote}
              rows={5}
              onInput={(event) => set({ doctorNote: event.currentTarget.value })}
            />
          </section>

          <section class="worksheet-editor__panel" aria-label="Поля">
            <h2 class="worksheet-editor__panel-title">Поля</h2>
            <ol class="worksheet-editor__list">
              <Index each={current().fields}>
                {(field, index) => (
                  <WorksheetFieldCard
                    field={field()}
                    index={index}
                    count={current().fields.length}
                    onChange={change}
                  />
                )}
              </Index>
            </ol>
            <Button
              type="button"
              class="worksheet-editor__add"
              disabled={!canAddWorksheetField(current())}
              icon={<AppGlyph name="plus" class="worksheet-editor__icon-glyph" />}
              onClick={() => change(addWorksheetField)}
            >
              Поле
            </Button>
          </section>

          <section class="worksheet-editor__panel" aria-label="Текст">
            <h2 class="worksheet-editor__panel-title">
              {current().layout === 'material' ? 'Текст материала' : 'Инструкция и правила'}
            </h2>
            <ol class="worksheet-editor__list">
              <Index each={current().sections}>
                {(section, index) => (
                  <li class="worksheet-editor__card">
                    <div class="worksheet-editor__card-head">
                      <TextField
                        class="worksheet-editor__grow"
                        label="Заголовок"
                        value={section().title}
                        onInput={(event) =>
                          change((worksheet) =>
                            updateWorksheetSection(worksheet, section().id, {
                              title: event.currentTarget.value,
                            }),
                          )
                        }
                      />
                      <IconButton
                        label="Выше"
                        icon="arrow-up"
                        disabled={index === 0}
                        onClick={() =>
                          change((worksheet) => moveWorksheetSection(worksheet, section().id, -1))
                        }
                      />
                      <IconButton
                        label="Ниже"
                        icon="caret-down"
                        disabled={index === current().sections.length - 1}
                        onClick={() =>
                          change((worksheet) => moveWorksheetSection(worksheet, section().id, 1))
                        }
                      />
                      <IconButton
                        label="Удалить раздел"
                        icon="trash"
                        onClick={() =>
                          change((worksheet) => removeWorksheetSection(worksheet, section().id))
                        }
                      />
                    </div>
                    <TextArea
                      label="Текст"
                      hideLabel
                      value={section().text}
                      rows={3}
                      onInput={(event) =>
                        change((worksheet) =>
                          updateWorksheetSection(worksheet, section().id, {
                            text: event.currentTarget.value,
                          }),
                        )
                      }
                    />
                  </li>
                )}
              </Index>
            </ol>
            <Button
              type="button"
              class="worksheet-editor__add"
              disabled={!canAddWorksheetSection(current())}
              icon={<AppGlyph name="plus" class="worksheet-editor__icon-glyph" />}
              onClick={() => change(addWorksheetSection)}
            >
              Раздел
            </Button>
          </section>

          <Show when={current().variants.length > 0}>
            <section class="worksheet-editor__panel" aria-label="Варианты">
              <h2 class="worksheet-editor__panel-title">Варианты</h2>
              <ol class="worksheet-editor__list">
                <Index each={current().variants}>
                  {(variant) => (
                    <li class="worksheet-editor__card">
                      <div class="worksheet-editor__card-head">
                        <TextField
                          class="worksheet-editor__grow"
                          label="Вариант"
                          value={variant().label}
                          onInput={(event) =>
                            change((worksheet) =>
                              updateWorksheetVariant(worksheet, variant().id, {
                                label: event.currentTarget.value,
                              }),
                            )
                          }
                        />
                        <IconButton
                          label="Удалить вариант"
                          icon="trash"
                          onClick={() =>
                            change((worksheet) => removeWorksheetVariant(worksheet, variant().id))
                          }
                        />
                      </div>
                      <TextArea
                        label="Для пациента"
                        value={variant().patientNote}
                        rows={2}
                        onInput={(event) =>
                          change((worksheet) =>
                            updateWorksheetVariant(worksheet, variant().id, {
                              patientNote: event.currentTarget.value,
                            }),
                          )
                        }
                      />
                      <TextArea
                        label="Для врача"
                        value={variant().doctorNote}
                        rows={2}
                        onInput={(event) =>
                          change((worksheet) =>
                            updateWorksheetVariant(worksheet, variant().id, {
                              doctorNote: event.currentTarget.value,
                            }),
                          )
                        }
                      />
                    </li>
                  )}
                </Index>
              </ol>
              <Button
                type="button"
                class="worksheet-editor__add"
                icon={<AppGlyph name="plus" class="worksheet-editor__icon-glyph" />}
                onClick={() => change(addWorksheetVariant)}
              >
                Вариант
              </Button>
            </section>
          </Show>
        </main>
      )}
    </Show>
  );
}
