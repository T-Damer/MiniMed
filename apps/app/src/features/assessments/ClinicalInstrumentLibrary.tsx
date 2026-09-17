import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchField } from '@/components/SearchField';
import {
  type ClinicalInstrumentPreset,
  clinicalInstrumentImportFile,
  searchClinicalInstrumentPresets,
} from '@/features/assessments/clinical-instrument-presets';
import './clinical-instrument-library.css';

export function ClinicalInstrumentLibrary(props: {
  readonly query: string;
  readonly onImport: (file: File) => void;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [selected, setSelected] = createSignal<ClinicalInstrumentPreset>();
  const [error, setError] = createSignal('');
  const matches = createMemo(() => searchClinicalInstrumentPresets(query()));
  const searchMatches = createMemo(() => searchClinicalInstrumentPresets(props.query));
  const close = (): void => {
    setOpen(false);
    setSelected(undefined);
    setError('');
  };
  const add = (preset: ClinicalInstrumentPreset): void => {
    try {
      const file = clinicalInstrumentImportFile(preset.id);
      props.onImport(file);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось подготовить опросник.');
    }
  };

  return (
    <Show when={!props.query.trim() || searchMatches().length > 0}>
      <section class="clinical-instrument-library" aria-label="Шкалы из опубликованных источников">
        <Button
          type="button"
          class="clinical-instrument-library__open"
          aria-haspopup="dialog"
          aria-expanded={open()}
          onClick={() => {
            setQuery(props.query);
            setSelected(undefined);
            setError('');
            setOpen(true);
          }}
          icon={<AppGlyph name="plus" class="clinical-instrument-library__icon" />}
        >
          Добавить шкалу из источника
        </Button>
        <span class="clinical-instrument-library__hint">
          PHQ-9 · GAD-7 · WHO-5 — в «Мои опросники»
        </span>
        <OverlayDialog
          open={open()}
          title={selected()?.title ?? 'Русские формы для личного использования'}
          class="clinical-instrument-dialog"
          onClose={close}
        >
          <Show when={selected()} fallback={
            <div class="clinical-instrument-dialog__body">
              <p class="clinical-instrument-dialog__text">
                Создаётся редактируемая локальная копия. Её можно пройти, распечатать и экспортировать.
                Формы имеют отдельные версии и ограничения; они не заменяют клиническую оценку.
              </p>
              <SearchField
                class="clinical-instrument-dialog__search"
                value={query()}
                label="Найти шкалу в источниках"
                placeholder="Название, сокращение или область"
                onInput={setQuery}
                onClear={() => setQuery('')}
              />
              <div class="clinical-instrument-dialog__list">
                <For each={matches()}>
                  {(preset) => (
                    <article class="clinical-instrument-choice" data-preset-id={preset.id}>
                      <h3 class="clinical-instrument-choice__title">{preset.title}</h3>
                      <p class="clinical-instrument-choice__specialties">{preset.specialties.join(' · ')}</p>
                      <div class="clinical-instrument-choice__actions">
                        <Button
                          type="button"
                          class="clinical-instrument-choice__add"
                          onClick={() => add(preset)}
                        >
                          Добавить локальную копию
                        </Button>
                        <Button
                          type="button"
                          variant="icon"
                          class="clinical-instrument-choice__help"
                          aria-label={`Описание и источник: ${preset.title}`}
                          title="Описание и источник"
                          onClick={() => setSelected(preset)}
                          icon={<AppGlyph name="question" class="clinical-instrument-library__icon" />}
                        />
                      </div>
                    </article>
                  )}
                </For>
              </div>
              <Show when={matches().length === 0}>
                <p class="clinical-instrument-dialog__text" role="status">
                  Готовой русской формы здесь пока нет. Свой опросник можно создать или импортировать
                  в разделе «Мои опросники». Запись во внешнем реестре не означает готовую форму.
                </p>
              </Show>
              <nav class="clinical-instrument-dialog__registries" aria-label="Внешние реестры инструментов">
                <a class="clinical-instrument-dialog__link" href="https://www.phenxtoolkit.org/resources/download" target="_blank" rel="noreferrer">
                  PhenX — протоколы по разделам медицины
                </a>
                <a class="clinical-instrument-dialog__link" href="https://www.mapi-trust.org/services/eprovide/proqolid" target="_blank" rel="noreferrer">
                  PROQOLID — переводы, версии и условия использования
                </a>
              </nav>
            </div>
          }>
            {(preset) => (
              <div class="clinical-instrument-dialog__body">
                <Button type="button" class="clinical-instrument-dialog__back" onClick={() => setSelected(undefined)}>
                  К списку форм
                </Button>
                <p class="clinical-instrument-dialog__text">{preset().description}</p>
                <p class="clinical-instrument-dialog__text">{preset().instructions}</p>
                <p class="clinical-instrument-dialog__text">{preset().population}</p>
                <p class="clinical-instrument-dialog__text">{preset().qualification}</p>
                <p class="clinical-instrument-dialog__text">{preset().scoreDescription}</p>
                <p class="clinical-instrument-dialog__text">{preset().disclaimer}</p>
                <p class="clinical-instrument-dialog__source">{preset().sourceNotice}</p>
                <a class="clinical-instrument-dialog__link" href={preset().sourceUrl} target="_blank" rel="noreferrer">
                  Оригинальная публикация и версия
                </a>
                <a class="clinical-instrument-dialog__link" href={preset().licenseUrl} target="_blank" rel="noreferrer">
                  {preset().license} — условия использования
                </a>
                <Button type="button" class="clinical-instrument-dialog__add" onClick={() => add(preset())}>
                  Добавить локальную копию
                </Button>
              </div>
            )}
          </Show>
          <Show when={error()}>
            {(message) => <p class="clinical-instrument-dialog__error" role="alert">{message()}</p>}
          </Show>
        </OverlayDialog>
      </section>
    </Show>
  );
}
