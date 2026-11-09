import { createMemo, createResource, createSignal, For, type JSX, Show } from 'solid-js';
import { toast } from 'solid-sonner';

import { PAGE_HEROES } from '@/app/page-heroes';
import { ChoiceGroup } from '@/components/ChoiceGroup';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import type { HeaderAction } from '@/components/HeaderActions';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { PageSkeleton } from '@/components/PageSkeleton';
import { Switch } from '@/components/Switch';
import { Heading } from '@/components/Text';
import { PrintManager } from '@/features/printing/print-manager';
import { ASSIGNMENT_CHECKLIST } from '@/features/worksheets/assignment-memo';
import {
  isBuiltInWorksheetId,
  loadBuiltInWorksheet,
} from '@/features/worksheets/built-in-worksheets';
import { WorksheetPatientView } from '@/features/worksheets/WorksheetPatientView';
import { worksheetPrintHtml } from '@/features/worksheets/worksheet-print';
import { pluralRu } from '@/i18n/labels';
import {
  activeWorksheetFields,
  type UserWorksheet,
  WORKSHEET_GROUP_LABEL,
  WORKSHEET_LAYOUT_LABEL,
  worksheetDoctorNote,
  worksheetHasExtendedFields,
} from '@/state/user-worksheet-format';
import {
  deleteUserWorksheet,
  loadUserWorksheet,
  saveUserWorksheet,
  saveWorksheetCopy,
} from '@/state/user-worksheets';

import '@/features/worksheets/worksheets.css';
import { worksheetHelpSources } from './worksheet-sources';

interface LoadedWorksheet {
  readonly worksheet: UserWorksheet;
  /** Library file id of a doctor's own sheet; absent for a built-in. */
  readonly fileId?: string;
}

async function loadWorksheet(id: string): Promise<LoadedWorksheet> {
  if (isBuiltInWorksheetId(id)) {
    const worksheet = await loadBuiltInWorksheet(id);
    if (!worksheet) throw new Error('Такого листа нет в библиотеке.');
    return { worksheet };
  }
  const stored = await loadUserWorksheet(id);
  return { worksheet: stored.worksheet, fileId: stored.file.id };
}

/** «8 полей»: the size of the extended version, next to its switch. */
function fieldCount(count: number): string {
  return `${count} ${pluralRu(count, 'поле', 'поля', 'полей')}`;
}

function Paragraphs(props: { readonly text: string; readonly class: string }): JSX.Element {
  const blocks = (): readonly string[] =>
    props.text
      .split(/\n{2,}/u)
      .map((block) => block.trim())
      .filter(Boolean);
  return <For each={blocks()}>{(block) => <p class={props.class}>{block}</p>}</For>;
}

/**
 * One CBT diary or homework sheet (CBT1): the doctor's explanation and what each field tells,
 * the version (basic or extended) and the kind (exposure variants), the sheet as the patient sees
 * it, the assigning checklist, printing a blank, and «Своя версия» — a copy in the library.
 */
export function WorksheetPage(props: {
  readonly id: string;
  readonly onBack: () => void;
  readonly onOpen: (id: string) => void;
  readonly onEdit: (fileId: string) => void;
}): JSX.Element {
  const [loaded, { mutate }] = createResource(() => props.id, loadWorksheet);
  const [deleting, setDeleting] = createSignal(false);
  const worksheet = (): UserWorksheet | undefined => loaded()?.worksheet;
  const own = (): boolean => loaded()?.fileId !== undefined;

  /** The version and the kind: a built-in changes for this view and print; an own sheet saves. */
  const change = (patch: Partial<Pick<UserWorksheet, 'extended' | 'variant'>>): void => {
    const current = loaded();
    if (!current) return;
    const next = { ...current.worksheet, ...patch } as UserWorksheet;
    mutate({ ...current, worksheet: next });
    if (current.fileId) {
      saveUserWorksheet(current.fileId, next).catch((cause: unknown) => {
        toast.error(cause instanceof Error ? cause.message : 'Не удалось сохранить.');
      });
    }
  };

  const print = (): void => {
    const current = worksheet();
    if (!current) return;
    if (!PrintManager.html(worksheetPrintHtml(current), current.title)) {
      toast.error('Браузер не открыл окно печати. Разрешите всплывающие окна.');
    }
  };

  const saveOwnVersion = async (): Promise<void> => {
    const current = worksheet();
    if (!current) return;
    try {
      const saved = await saveWorksheetCopy(current);
      toast.success('Своя версия сохранена в библиотеку.');
      props.onEdit(saved.file.id);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось сохранить копию.');
    }
  };

  const remove = async (): Promise<void> => {
    const fileId = loaded()?.fileId;
    if (!fileId) return;
    try {
      await deleteUserWorksheet(fileId);
      toast.success('Дневник удалён из библиотеки.');
      props.onBack();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось удалить.');
    }
  };

  const headerActions = createMemo<readonly HeaderAction[]>(() => {
    const fileId = loaded()?.fileId;
    return [
      ...(fileId
        ? [
            {
              id: 'edit',
              label: 'Изменить',
              icon: 'edit',
              priority: 1,
              onSelect: () => props.onEdit(fileId),
              testId: 'worksheet-edit',
            } satisfies HeaderAction,
          ]
        : []),
      {
        id: 'print',
        label: 'Печать бланка',
        icon: 'printer',
        priority: 1,
        onSelect: print,
        testId: 'worksheet-print',
      },
      {
        id: 'copy',
        label: fileId ? 'Копия' : 'Своя версия',
        icon: 'copy',
        priority: 2,
        onSelect: () => void saveOwnVersion(),
        testId: 'worksheet-copy',
      },
      ...(fileId
        ? [
            {
              id: 'delete',
              label: 'Удалить',
              icon: 'trash',
              priority: 3,
              danger: true,
              menuOnly: true,
              onSelect: () => setDeleting(true),
            } satisfies HeaderAction,
          ]
        : []),
    ];
  });

  return (
    <Show
      when={worksheet()}
      fallback={
        <Show when={loaded.error} fallback={<PageSkeleton fallbackHash="#/notes/worksheets" />}>
          <main class="worksheet-page">
            <Page
              navigation={<NavBack aria-label="Назад" onClick={props.onBack} />}
              title={<Heading depth={1}>Дневник не найден</Heading>}
            />
          </main>
        </Show>
      }
    >
      {(current) => (
        <main class="worksheet-page" aria-label={current().title}>
          <Page
            hero={PAGE_HEROES.library}
            navigation={<NavBack aria-label="Назад" onClick={props.onBack} />}
            title={<Heading depth={1}>{current().title}</Heading>}
            description={
              <span class="worksheet-page__kind">
                {WORKSHEET_GROUP_LABEL[current().group]} ·{' '}
                {WORKSHEET_LAYOUT_LABEL[current().layout].toLowerCase()}
                {own() ? ' · своя версия' : ''}
              </span>
            }
            headerActions={headerActions()}
            helpTitle="О листе"
            help={<p>{current().summary}</p>}
            helpSources={worksheetHelpSources(current())}
          />

          <Show when={current().draft}>
            <p class="worksheet-page__draft">
              Черновик текстов — проверьте пояснения перед тем, как дать пациенту
            </p>
          </Show>

          <Show when={current().variants.length > 0 || worksheetHasExtendedFields(current())}>
            <div class="worksheet-page__options">
              <Show when={current().variants.length > 0}>
                <ChoiceGroup
                  legend="Вариант"
                  class="worksheet-page__variants"
                  orientation="horizontal"
                  options={current().variants.map((variant) => ({
                    value: variant.id,
                    label: variant.label,
                  }))}
                  value={current().variant ?? current().variants[0]?.id ?? ''}
                  onChange={(variant) => change({ variant })}
                />
              </Show>
              <Show when={worksheetHasExtendedFields(current())}>
                <div class="worksheet-page__switch-row">
                  <span class="worksheet-page__switch-label">
                    Расширенная версия · {fieldCount(current().fields.length)}
                  </span>
                  <Switch
                    aria-label="Расширенная версия"
                    checked={current().extended}
                    onChange={(extended) => change({ extended })}
                  />
                </div>
              </Show>
            </div>
          </Show>

          <section class="worksheet-page__panel" aria-label="Для врача">
            <h2 class="worksheet-page__panel-title">Для врача</h2>
            <Paragraphs text={worksheetDoctorNote(current())} class="worksheet-page__text" />
            <Show when={activeWorksheetFields(current()).some((field) => field.doctorHint)}>
              <dl class="worksheet-page__fields">
                <For each={activeWorksheetFields(current()).filter((field) => field.doctorHint)}>
                  {(field) => (
                    <>
                      <dt class="worksheet-page__field-name">{field.label}</dt>
                      <dd class="worksheet-page__field-hint">{field.doctorHint}</dd>
                    </>
                  )}
                </For>
              </dl>
            </Show>
          </section>

          <section class="worksheet-page__panel worksheet-page__panel--patient">
            <h2 class="worksheet-page__panel-title">Как увидит пациент</h2>
            <WorksheetPatientView worksheet={current()} />
          </section>

          <section class="worksheet-page__panel" aria-label="Как дать задание">
            <h2 class="worksheet-page__panel-title">Как дать задание</h2>
            <ul class="worksheet-page__checklist">
              <For each={ASSIGNMENT_CHECKLIST}>
                {(check) => <li class="worksheet-page__check">{check.text}</li>}
              </For>
            </ul>
          </section>

          <ConfirmationDialog
            open={deleting()}
            title="Удалить дневник?"
            description={<>«{current().title}» будет удалён из библиотеки.</>}
            confirmLabel="Удалить"
            danger
            icon="trash"
            onConfirm={() => void remove()}
            onOpenChange={setDeleting}
          />
        </main>
      )}
    </Show>
  );
}
