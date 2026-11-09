import {
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { toast } from 'solid-sonner';

import { PAGE_HEROES } from '@/app/page-heroes';
import { AppGlyph, type AppGlyphName } from '@/components/AppGlyph';
import type { HeaderAction } from '@/components/HeaderActions';
import { NavBack } from '@/components/NavBack';
import { Page } from '@/components/Page';
import { SearchField } from '@/components/SearchField';
import { SkeletonLines } from '@/components/SkeletonLines';
import { Heading } from '@/components/Text';
import { ASSIGNMENT_CHECKLIST } from '@/features/worksheets/assignment-memo';
import { loadBuiltInWorksheets } from '@/features/worksheets/built-in-worksheets';
import { matchesFuzzyQuery } from '@/state/fuzzy-text';
import { USER_LIBRARY_EVENT } from '@/state/user-library';
import {
  type UserWorksheet,
  WORKSHEET_GROUP_LABEL,
  WORKSHEET_GROUPS,
  type WorksheetGroup,
} from '@/state/user-worksheet-format';
import {
  createUserWorksheet,
  listUserWorksheets,
  type StoredUserWorksheet,
} from '@/state/user-worksheets';

import '@/features/worksheets/worksheets.css';

export const WORKSHEET_GROUP_GLYPH: Readonly<Record<WorksheetGroup, AppGlyphName>> = {
  'self-monitoring': 'notepad',
  cognitive: 'brain',
  experiment: 'flask',
  activation: 'calendar-check',
  exposure: 'arrows-down-up',
  skills: 'leaf',
  education: 'book-open',
};

function WorksheetRow(props: {
  readonly worksheet: UserWorksheet;
  readonly onOpen: () => void;
}): JSX.Element {
  return (
    <li class="worksheets-catalog__item">
      <button type="button" class="worksheets-catalog__row" onClick={props.onOpen}>
        <AppGlyph
          name={WORKSHEET_GROUP_GLYPH[props.worksheet.group]}
          class="worksheets-catalog__glyph"
        />
        <span class="worksheets-catalog__copy">
          <span class="worksheets-catalog__name">{props.worksheet.title}</span>
          <Show when={props.worksheet.summary}>
            <span class="worksheets-catalog__summary">{props.worksheet.summary}</span>
          </Show>
        </span>
        <Show when={props.worksheet.draft}>
          <span class="worksheets-catalog__badge">черновик</span>
        </Show>
      </button>
    </li>
  );
}

/**
 * «Дневники и задания» (CBT1): the built-in CBT diaries and homework by section, and the doctor's
 * own versions saved in the library. A sheet opens its page: explanations, the patient's view,
 * printing, «Сохранить свою версию».
 */
export function WorksheetsCatalog(props: {
  readonly onBack: () => void;
  readonly onOpen: (id: string) => void;
  readonly onEdit: (fileId: string) => void;
}): JSX.Element {
  const [search, setSearch] = createSignal('');
  const [builtIns] = createResource(loadBuiltInWorksheets);
  const [own, setOwn] = createSignal<readonly StoredUserWorksheet[] | undefined>();

  const refresh = async (): Promise<void> => {
    try {
      setOwn(await listUserWorksheets());
    } catch (cause) {
      setOwn([]);
      toast.error(cause instanceof Error ? cause.message : 'Не удалось открыть библиотеку.');
    }
  };
  onMount(() => {
    void refresh();
    window.addEventListener(USER_LIBRARY_EVENT, refresh);
  });
  onCleanup(() => window.removeEventListener(USER_LIBRARY_EVENT, refresh));

  const matches = (worksheet: UserWorksheet): boolean => {
    const query = search().trim();
    return (
      !query ||
      matchesFuzzyQuery(query, [
        worksheet.title,
        worksheet.summary,
        WORKSHEET_GROUP_LABEL[worksheet.group],
      ])
    );
  };
  const ownShown = createMemo(() => (own() ?? []).filter((item) => matches(item.worksheet)));
  const groups = createMemo(() =>
    WORKSHEET_GROUPS.map((group) => ({
      group,
      items: (builtIns() ?? []).filter((item) => item.group === group && matches(item)),
    })).filter((entry) => entry.items.length > 0),
  );
  const nothingFound = (): boolean =>
    builtIns() !== undefined &&
    own() !== undefined &&
    ownShown().length === 0 &&
    groups().length === 0;

  const createOwn = async (): Promise<void> => {
    try {
      const created = await createUserWorksheet();
      props.onEdit(created.file.id);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Не удалось создать дневник.');
    }
  };

  const headerActions = createMemo<readonly HeaderAction[]>(() => [
    {
      id: 'create',
      label: 'Создать свой дневник',
      icon: 'plus',
      priority: 2,
      onSelect: () => void createOwn(),
      testId: 'worksheet-create',
    },
  ]);

  return (
    <main class="worksheets-catalog" aria-label="Дневники и задания">
      <Page
        hero={PAGE_HEROES.library}
        navigation={<NavBack aria-label="Назад" onClick={props.onBack} />}
        title={<Heading depth={1}>Дневники и задания</Heading>}
        headerActions={headerActions()}
        helpTitle="Как давать задание"
        help={
          <>
            <p>
              Готовые дневники и домашние задания КПТ. Откройте лист, чтобы прочитать пояснения,
              увидеть его глазами пациента и распечатать. «Своя версия» сохраняет копию в библиотеку
              — её можно менять под пациента.
            </p>
            <ul class="worksheets-catalog__checklist">
              <For each={ASSIGNMENT_CHECKLIST}>
                {(check) => <li class="worksheets-catalog__check">{check.text}</li>}
              </For>
            </ul>
          </>
        }
      />
      <SearchField
        class="worksheets-catalog__search"
        value={search()}
        onInput={setSearch}
        label="Найти дневник или задание"
        hideLabel
        placeholder="Найти дневник или задание"
      />
      <Show
        when={builtIns() !== undefined}
        fallback={<SkeletonLines label="Загружаем дневники и задания" lines={8} />}
      >
        <Show when={ownShown().length > 0}>
          <section class="worksheets-catalog__group" aria-label="Мои версии">
            <h2 class="worksheets-catalog__group-title">Мои версии</h2>
            <ul class="worksheets-catalog__list">
              <For each={ownShown()}>
                {(item) => (
                  <WorksheetRow
                    worksheet={item.worksheet}
                    onOpen={() => props.onOpen(item.file.id)}
                  />
                )}
              </For>
            </ul>
          </section>
        </Show>
        <For each={groups()}>
          {(entry) => (
            <section
              class="worksheets-catalog__group"
              aria-label={WORKSHEET_GROUP_LABEL[entry.group]}
            >
              <h2 class="worksheets-catalog__group-title">{WORKSHEET_GROUP_LABEL[entry.group]}</h2>
              <ul class="worksheets-catalog__list">
                <For each={entry.items}>
                  {(worksheet) => (
                    <WorksheetRow worksheet={worksheet} onOpen={() => props.onOpen(worksheet.id)} />
                  )}
                </For>
              </ul>
            </section>
          )}
        </For>
        <Show when={nothingFound()}>
          <p class="worksheets-catalog__nothing">Ничего не нашли</p>
        </Show>
      </Show>
    </main>
  );
}
