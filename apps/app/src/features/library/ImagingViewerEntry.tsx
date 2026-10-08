import { createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import { FileButton } from '@/components/FileButton';
import { useFinePointer } from '@/components/fine-pointer';
import {
  createUserLibraryDocuments,
  dragCarriesFiles,
  importAndOpenImagingFiles,
  openImagingStudy,
  selectImagingStudies,
} from '@/features/library/imaging-entry';
import { formatModuleBytes } from '@/features/modules/module-display';
import { userLibraryFileAccept } from '@/state/user-library';

import './imaging-entry.css';

/**
 * «Просмотр снимков» with nothing open: study list from «Мои файлы», a file picker that imports
 * through the library, and a drop target. Opening anything navigates to the viewer and closes this.
 */
export function ImagingViewerEntry(props: { readonly onOpened: () => void }): JSX.Element {
  const documents = createUserLibraryDocuments();
  // Dragging a file onto the page is a desktop gesture: a phone is told to pick one.
  const canDrop = useFinePointer();
  const list = () => selectImagingStudies(documents());
  const [dragging, setDragging] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string>();

  const importFiles = async (files: readonly File[]): Promise<void> => {
    setProblem(undefined);
    setBusy(true);
    const failure = await importAndOpenImagingFiles(files);
    setBusy(false);
    if (failure) setProblem(failure);
    else props.onOpened();
  };

  return (
    <section class="imaging-entry" data-testid="imaging-entry">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target; «Открыть новый файл» is the keyboard path. */}
      <div
        class="imaging-entry__drop"
        classList={{ 'imaging-entry__drop--active': dragging() }}
        data-testid="imaging-drop"
        onDragEnter={(event) => {
          if (!dragCarriesFiles(event.dataTransfer)) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (!dragCarriesFiles(event.dataTransfer)) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void importFiles(Array.from(event.dataTransfer?.files ?? []));
        }}
      >
        <AppGlyph name="image" class="imaging-entry__icon" />
        <p class="imaging-entry__lead">
          {canDrop() ? 'Перетащите сюда снимок DICOM или NIfTI' : 'Выберите снимок DICOM или NIfTI'}
        </p>
        <p class="imaging-entry__hint">
          Файл сохранится в «Мои файлы» → «Исследования» и откроется в просмотре.
        </p>
        <FileButton
          variant="primary"
          accept={userLibraryFileAccept()}
          disabled={busy()}
          data-testid="imaging-file-input"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            void importFiles(files);
          }}
        >
          {busy() ? 'Добавляем…' : 'Открыть новый файл'}
        </FileButton>
      </div>
      <Show when={problem()}>
        {(message) => (
          <p class="imaging-entry__problem" role="alert">
            {message()}
          </p>
        )}
      </Show>
      <section class="imaging-entry__studies" aria-labelledby="imaging-entry-studies">
        <h3 class="imaging-entry__heading" id="imaging-entry-studies">
          Открыть из моих файлов
        </h3>
        <Show
          when={list().length > 0}
          fallback={
            <p class="imaging-entry__empty">
              {canDrop()
                ? 'В «Моих файлах» пока нет снимков. Откройте новый файл или перетащите его сюда.'
                : 'В «Моих файлах» пока нет снимков.'}
            </p>
          }
        >
          <ul class="imaging-entry__list">
            <For each={list()}>
              {(study) => (
                <li class="imaging-entry__item">
                  <button
                    type="button"
                    class="imaging-entry__study"
                    onClick={() => {
                      openImagingStudy(study);
                      props.onOpened();
                    }}
                  >
                    <AppGlyph name="image" class="imaging-entry__study-icon" />
                    <span class="imaging-entry__study-copy">
                      <span class="imaging-entry__study-title">{study.title}</span>
                      <span class="imaging-entry__study-meta">
                        {study.fileName} · {formatModuleBytes(study.byteLength)}
                      </span>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </section>
  );
}
