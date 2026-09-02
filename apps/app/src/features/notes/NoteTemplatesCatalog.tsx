import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { NavBack } from '@/components/NavBack';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchField } from '@/components/SearchField';
import { HOME_VISIT_EXAMINATION_TEMPLATE } from '@/features/notes/note-template-examples';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';
import {
  addUserLibraryFile,
  listUserLibraryDocuments,
  normalizeUserLibraryName,
  USER_LIBRARY_EVENT,
  USER_LIBRARY_NAME_MAX_LENGTH,
  USER_LIBRARY_TEMPLATES_FOLDER_ID,
  type UserLibraryDocument,
} from '@/state/user-library';
import { createEditableUserLibraryFile } from '@/state/user-library-formats';

const TEMPLATE_FILE_ACCEPT = [
  '.md',
  '.markdown',
  '.txt',
  '.rtf',
  '.doc',
  '.docx',
  'text/markdown',
  'text/plain',
  'text/rtf',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',');

function templateFileName(title: string): string {
  const base = title.replace(/\.md$/iu, '').trim();
  if (!base) throw new Error('Введите название шаблона.');
  const maxBaseLength = USER_LIBRARY_NAME_MAX_LENGTH - '.md'.length;
  return normalizeUserLibraryName(`${[...base].slice(0, maxBaseLength).join('')}.md`, 'file');
}

function templateStatus(document: UserLibraryDocument): string {
  if (document.status === 'inspecting') return 'Подготавливаем шаблон…';
  if (document.status === 'failed') return 'Не удалось подготовить шаблон';
  return document.fileName;
}

export function NoteTemplatesCatalog(props: {
  readonly onOpenTemplate: (documentId: string) => void;
  readonly onBack: () => void;
  readonly createOnMount?: boolean;
}): JSX.Element {
  const [templates, setTemplates] = createSignal<readonly UserLibraryDocument[]>([]);
  const [search, setSearch] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [title, setTitle] = createSignal('');
  let fileInput: HTMLInputElement | undefined;

  const openCreateDialog = (): void => {
    setTitle('');
    setCreating(true);
  };
  let createRequestActive = false;

  createEffect(() => {
    const requested = props.createOnMount === true;
    if (requested && !createRequestActive) openCreateDialog();
    if (!requested && createRequestActive) setCreating(false);
    createRequestActive = requested;
  });

  const refresh = async (): Promise<void> => {
    try {
      const documents = await listUserLibraryDocuments();
      setTemplates(
        documents
          .filter((document) => document.folderId === USER_LIBRARY_TEMPLATES_FOLDER_ID)
          .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось открыть шаблоны.');
    }
  };

  onMount(() => {
    void refresh();
    window.addEventListener(USER_LIBRARY_EVENT, refresh);
  });
  onCleanup(() => window.removeEventListener(USER_LIBRARY_EVENT, refresh));

  const visibleTemplates = (): readonly UserLibraryDocument[] => {
    const query = search().trim();
    if (!query) return templates();
    return templates().filter((document) =>
      matchesFuzzyQuery(query, [document.title, document.fileName]),
    );
  };

  const addTemplate = async (nextTitle: string, markdown: string): Promise<void> => {
    const fileName = templateFileName(nextTitle);
    const file = createEditableUserLibraryFile(fileName, 'text/markdown', markdown);
    const saved = await addUserLibraryFile(file, USER_LIBRARY_TEMPLATES_FOLDER_ID);
    await refresh();
    props.onOpenTemplate(saved.id);
  };

  const createTemplate = async (): Promise<void> => {
    const nextTitle = title().trim();
    if (!nextTitle) return;
    try {
      await addTemplate(nextTitle, `# ${nextTitle}\n\n`);
      setTitle('');
      setCreating(false);
      toast.success(`Создан шаблон «${nextTitle}».`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось создать шаблон.');
    }
  };

  const createExample = async (): Promise<void> => {
    try {
      await addTemplate(
        HOME_VISIT_EXAMINATION_TEMPLATE.title,
        HOME_VISIT_EXAMINATION_TEMPLATE.markdown,
      );
      toast.success('Создан шаблон «Осмотр на дому».');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось создать шаблон.');
    }
  };

  const uploadTemplates = async (files: FileList | null): Promise<void> => {
    let added = 0;
    for (const file of Array.from(files ?? [])) {
      try {
        await addUserLibraryFile(file, USER_LIBRARY_TEMPLATES_FOLDER_ID);
        added += 1;
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : `Не удалось загрузить «${file.name}».`,
        );
      }
    }
    if (added > 0) toast.success(`Загружено шаблонов: ${added}.`);
    await refresh();
  };

  return (
    <main class="note-templates-catalog" aria-label="Ваши шаблоны">
      <input
        ref={(element) => {
          fileInput = element;
        }}
        class="note-templates-catalog__file-input"
        type="file"
        accept={TEMPLATE_FILE_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          void uploadTemplates(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
      <div class="note-templates-catalog__search-chrome knowledge-subroute-heading knowledge-subroute-heading--blurred">
        <NavBack
          class="note-templates-catalog__back knowledge-back-button knowledge-subroute-heading__control"
          aria-label="Назад к заметкам"
          onClick={props.onBack}
        />
        <SearchField
          class="note-templates-catalog__search route-search knowledge-subroute-heading__control"
          id="note-templates-search"
          value={search()}
          onInput={setSearch}
          onClear={() => setSearch('')}
          label="Поиск по шаблонам"
          hideLabel
          placeholder="Название шаблона или файл"
        />
      </div>

      <div class="note-templates-catalog__toolbar">
        <h1 class="note-templates-catalog__title sr-only">Ваши шаблоны</h1>
        <nav class="note-templates-catalog__breadcrumbs" aria-label="Раздел библиотеки">
          <AppGlyph name="notepad" class="note-templates-catalog__breadcrumb-icon" />
          <span class="note-templates-catalog__breadcrumb-label">Ваши шаблоны</span>
        </nav>
        <div class="note-templates-catalog__actions">
          <Button
            type="button"
            variant="icon"
            class="note-templates-catalog__action note-templates-catalog__create ui-button--primary"
            aria-label="Создать шаблон"
            title="Создать шаблон"
            onClick={openCreateDialog}
            icon={<AppGlyph name="plus" class="note-templates-catalog__action-icon" />}
          />
          <Button
            type="button"
            variant="icon"
            class="note-templates-catalog__action note-templates-catalog__upload"
            aria-label="Загрузить шаблоны"
            title="Загрузить шаблоны"
            onClick={() => fileInput?.click()}
            icon={<AppGlyph name="file-plus" class="note-templates-catalog__action-icon" />}
          />
        </div>
      </div>

      <div class="note-templates-catalog__list">
        <button
          type="button"
          class="note-templates-catalog__example paper-card"
          onClick={() => void createExample()}
        >
          <span class="note-templates-catalog__card-icon" aria-hidden="true">
            <AppGlyph name="file-plus" class="note-templates-catalog__card-icon-glyph" />
          </span>
          <span class="note-templates-catalog__card-copy">
            <strong class="note-templates-catalog__card-title">Осмотр на дому</strong>
            <small class="note-templates-catalog__card-meta">Создать редактируемую копию</small>
          </span>
        </button>

        <For each={visibleTemplates()}>
          {(template) => (
            <button
              type="button"
              class="note-templates-catalog__template paper-card"
              onClick={() => props.onOpenTemplate(template.id)}
            >
              <span class="note-templates-catalog__card-icon" aria-hidden="true">
                <AppGlyph name="file-text" class="note-templates-catalog__card-icon-glyph" />
              </span>
              <span class="note-templates-catalog__card-copy">
                <strong class="note-templates-catalog__card-title">{template.title}</strong>
                <small class="note-templates-catalog__card-meta">{templateStatus(template)}</small>
              </span>
            </button>
          )}
        </For>
        <Show when={visibleTemplates().length === 0 && search().trim()}>
          <p class="note-templates-catalog__empty paper-card">Ничего не найдено.</p>
        </Show>
      </div>

      <OverlayDialog
        open={creating()}
        title="Новый шаблон"
        class="note-templates-catalog__dialog"
        onClose={() => setCreating(false)}
      >
        <form
          class="note-templates-catalog__form"
          onSubmit={(event) => {
            event.preventDefault();
            void createTemplate();
          }}
        >
          <input
            class="note-templates-catalog__title-input"
            type="text"
            value={title()}
            placeholder="Название шаблона"
            aria-label="Название нового шаблона"
            autofocus
            onInput={(event) => setTitle(event.currentTarget.value)}
          />
          <div class="note-templates-catalog__form-actions">
            <Button type="submit" variant="primary" disabled={!title().trim()}>
              Создать
            </Button>
            <Button type="button" variant="quiet" onClick={() => setCreating(false)}>
              Отмена
            </Button>
          </div>
        </form>
      </OverlayDialog>
    </main>
  );
}
