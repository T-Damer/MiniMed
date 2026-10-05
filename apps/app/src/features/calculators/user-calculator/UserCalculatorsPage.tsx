import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { AppBreadcrumbs } from '@/components/AppBreadcrumbs';
import { AppGlyph } from '@/components/AppGlyph';
import { Button } from '@/components/Button';
import { ConfirmationDialog } from '@/components/ConfirmationDialog';
import { FileDropZone } from '@/components/FileDropZone';
import { NavBack } from '@/components/NavBack';
import { OverlayDialog } from '@/components/OverlayDialog';
import { Page } from '@/components/Page';
import { QueryEmptyState } from '@/components/QueryEmptyState';
import { SearchField } from '@/components/SearchField';
import { Heading } from '@/components/Text';
import { USER_CALCULATORS_EVENT } from '@/features/calculators/calculator-events';
import { userCalculatorBlockingError } from '@/features/calculators/user-calculator/user-calculator-schema';
import { ToolAgeBadge } from '@/features/tools/ToolAgeBadge';
import { ToolAgeFilterBar } from '@/features/tools/ToolAgeFilterBar';
import { toolMatchesAgeFilter } from '@/features/tools/tool-age-filter';
import { createToolAgeFilter } from '@/features/tools/tool-age-filter-state';
import {
  userToolPopulationError,
  userToolPopulationToAgeScope,
} from '@/features/tools/user-tool-population';
import { pluralRu } from '@/i18n/labels';
import { shareSystemFile } from '@/state/native-share';
import {
  deleteUserCalculator,
  duplicateUserCalculator,
  exportUserCalculator,
  importUserCalculator,
  listUserCalculators,
  USER_CALCULATOR_FILE_EXTENSION,
  USER_CALCULATOR_MIME_TYPE,
  type UserCalculator,
  userCalculatorStorageProblems,
} from '@/state/user-calculators';

import '@/features/calculators/user-calculator/user-calculator.css';

export function inputCountLabel(count: number): string {
  if (count === 0) return 'Нет входных данных';
  return `${count} ${pluralRu(count, 'входное значение', 'входных значения', 'входных значений')}`;
}

function ageScopeOf(model: UserCalculator) {
  return model.population && userToolPopulationError(model.population) === null
    ? userToolPopulationToAgeScope(model.population)
    : undefined;
}

function matchesQuery(model: UserCalculator, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  if (!needle) return true;
  return [
    model.title,
    model.description,
    model.result.label,
    ...model.inputs.map((input) => input.label),
  ].some((text) => text.toLocaleLowerCase('ru-RU').includes(needle));
}

/** «Мои калькуляторы»: the doctor's own calculators, with create, import, copy, export and delete. */
export function UserCalculatorsPage(props: {
  readonly onBack: () => void;
  readonly onCreate: () => void;
  readonly onOpen: (model: UserCalculator) => void;
  readonly onEdit: (id: string) => void;
  readonly onMessage: (message: string) => void;
}): JSX.Element {
  const [models, setModels] = createSignal<readonly UserCalculator[]>(listUserCalculators());
  const [problems, setProblems] = createSignal<readonly string[]>(userCalculatorStorageProblems());
  const [query, setQuery] = createSignal('');
  const [importOpen, setImportOpen] = createSignal(false);
  const [pendingDelete, setPendingDelete] = createSignal<UserCalculator | undefined>();
  const [ageFilter, setAgeFilter] = createToolAgeFilter();

  const refresh = (): void => {
    setModels(listUserCalculators());
    setProblems(userCalculatorStorageProblems());
  };
  onMount(() => window.addEventListener(USER_CALCULATORS_EVENT, refresh));
  onCleanup(() => window.removeEventListener(USER_CALCULATORS_EVENT, refresh));

  const forAge = createMemo(() =>
    models().filter((model) => {
      const scope = ageScopeOf(model);
      // A calculator without a valid population is unfinished: it stays visible under every filter.
      return scope === undefined || toolMatchesAgeFilter(scope, ageFilter());
    }),
  );
  const visible = createMemo(() => forAge().filter((model) => matchesQuery(model, query())));

  const report = (cause: unknown, fallback: string): void => {
    props.onMessage(cause instanceof Error ? cause.message : fallback);
  };

  const copy = (model: UserCalculator): void => {
    try {
      const created = duplicateUserCalculator(model.id);
      props.onMessage(`Создана копия «${created.title}».`);
    } catch (cause) {
      report(cause, 'Не удалось создать копию.');
    }
  };

  const exportFile = (model: UserCalculator): void => {
    try {
      const file = exportUserCalculator(model.id);
      void shareSystemFile({
        title: file.name.slice(0, -USER_CALCULATOR_FILE_EXTENSION.length),
        fileName: file.name,
        mimeType: USER_CALCULATOR_MIME_TYPE,
        blob: file,
      })
        .then((result) => {
          if (result === 'cancelled') return;
          props.onMessage(
            result === 'shared' ? 'Калькулятор передан.' : 'Калькулятор экспортирован в файл.',
          );
        })
        .catch((cause: unknown) => report(cause, 'Не удалось экспортировать калькулятор.'));
    } catch (cause) {
      report(cause, 'Не удалось экспортировать калькулятор.');
    }
  };

  const importFile = (file: File): void => {
    setImportOpen(false);
    void importUserCalculator(file)
      .then((created) => {
        props.onMessage(`Калькулятор «${created.title}» импортирован.`);
        props.onEdit(created.id);
      })
      .catch((cause: unknown) => report(cause, 'Не удалось импортировать калькулятор.'));
  };

  const confirmDelete = (): void => {
    const target = pendingDelete();
    setPendingDelete(undefined);
    if (!target) return;
    try {
      deleteUserCalculator(target.id);
      props.onMessage(`Калькулятор «${target.title}» удалён.`);
    } catch (cause) {
      report(cause, 'Не удалось удалить калькулятор.');
    }
  };

  return (
    <div class="user-calculators" data-testid="user-calculators">
      <Page
        class="user-calculators__header"
        navigation={
          <NavBack
            class="user-calculators__back"
            aria-label="К калькуляторам"
            title="К калькуляторам"
            onClick={props.onBack}
          />
        }
        breadcrumbs={
          <AppBreadcrumbs
            items={[
              { label: 'Калькуляторы', href: '#/calculators' },
              { label: 'Мои калькуляторы' },
            ]}
            onNavigate={(href) => {
              window.location.hash = href;
            }}
          />
        }
        icon={<AppGlyph name="calculator" class="page__icon-glyph" />}
        title={<Heading depth={1}>Мои калькуляторы</Heading>}
        description="Составьте свой калькулятор: входные данные, формула и диапазоны результата. Он работает без сети и хранится только на этом устройстве."
        actions={
          <div class="user-calculators__actions">
            <Button
              type="button"
              variant="icon"
              class="user-calculators__import"
              aria-label="Импортировать калькулятор"
              title="Импортировать калькулятор"
              data-testid="user-calculators-import"
              onClick={() => setImportOpen(true)}
              icon={<AppGlyph name="file-arrow-down" class="user-calculators__icon" />}
            />
            <Button
              type="button"
              variant="primary"
              class="user-calculators__create"
              data-testid="user-calculators-create"
              onClick={props.onCreate}
              icon={<AppGlyph name="plus" class="user-calculators__icon" />}
            >
              Создать
            </Button>
          </div>
        }
      />

      <Show when={problems().length > 0}>
        <div class="user-calculators__problems" role="alert">
          <For each={problems()}>
            {(problem) => <p class="user-calculators__problem">{problem}</p>}
          </For>
        </div>
      </Show>

      <Show when={models().length > 0}>
        <SearchField
          class="user-calculators__search"
          value={query()}
          placeholder="Название, описание или данные"
          label="Найти калькулятор"
          hideLabel
          onInput={setQuery}
          onClear={() => setQuery('')}
        />
        <ToolAgeFilterBar
          class="user-calculators__age-filter"
          value={ageFilter()}
          onChange={setAgeFilter}
          hidden={models().length - forAge().length}
        />
      </Show>

      <Show
        when={models().length > 0}
        fallback={
          <section class="user-calculators__empty paper-card" data-testid="user-calculators-empty">
            <Heading depth={2}>Пока нет своих калькуляторов</Heading>
            <p class="user-calculators__empty-text">
              Например, индекс массы тела или клиренс креатинина по своей формуле. Создайте
              калькулятор или импортируйте файл коллеги.
            </p>
            <Button
              type="button"
              variant="primary"
              class="user-calculators__empty-create"
              onClick={props.onCreate}
              icon={<AppGlyph name="plus" class="user-calculators__icon" />}
            >
              Создать калькулятор
            </Button>
          </section>
        }
      >
        <Show
          when={visible().length > 0}
          fallback={
            <QueryEmptyState
              {...(forAge().length === 0
                ? {
                    message:
                      'Для выбранного возраста нет калькуляторов. Выберите «Все», чтобы увидеть остальные.',
                  }
                : {})}
            />
          }
        >
          <div class="user-calculators__grid">
            <For each={visible()}>
              {(model) => {
                const blocking = () => userCalculatorBlockingError(model);
                const scope = () => ageScopeOf(model);
                return (
                  <article
                    class="user-calculator-card paper-card"
                    data-testid="user-calculator-card"
                    data-calculator-id={model.id}
                  >
                    <div class="user-calculator-card__topline">
                      <span class="user-calculator-card__kind">Локальный калькулятор</span>
                      <div class="user-calculator-card__actions">
                        <Button
                          type="button"
                          variant="icon"
                          class="user-calculator-card__action"
                          aria-label={`Редактировать «${model.title}»`}
                          title="Редактировать"
                          data-testid="user-calculator-edit"
                          onClick={() => props.onEdit(model.id)}
                          icon={<AppGlyph name="edit" class="user-calculators__icon" />}
                        />
                        <Button
                          type="button"
                          variant="icon"
                          class="user-calculator-card__action"
                          aria-label={`Копировать «${model.title}»`}
                          title="Копировать"
                          data-testid="user-calculator-copy"
                          onClick={() => copy(model)}
                          icon={<AppGlyph name="squares-four" class="user-calculators__icon" />}
                        />
                        <Button
                          type="button"
                          variant="icon"
                          class="user-calculator-card__action"
                          aria-label={`Экспортировать «${model.title}»`}
                          title="Экспортировать"
                          data-testid="user-calculator-export"
                          onClick={() => exportFile(model)}
                          icon={<AppGlyph name="share" class="user-calculators__icon" />}
                        />
                        <Button
                          type="button"
                          variant="icon"
                          class="user-calculator-card__action user-calculator-card__action--danger"
                          aria-label={`Удалить «${model.title}»`}
                          title="Удалить"
                          data-testid="user-calculator-delete"
                          onClick={() => setPendingDelete(model)}
                          icon={<AppGlyph name="trash" class="user-calculators__icon" />}
                        />
                      </div>
                    </div>
                    <h2 class="user-calculator-card__title">{model.title || 'Без названия'}</h2>
                    <p class="user-calculator-card__description">
                      {model.description || 'Без описания'}
                    </p>
                    <small class="user-calculator-card__meta">
                      {inputCountLabel(model.inputs.length)}
                    </small>
                    <Show
                      when={scope()}
                      fallback={
                        <span class="user-calculator-card__population-missing">
                          Не указано, для кого калькулятор
                        </span>
                      }
                    >
                      {(ageScope) => <ToolAgeBadge scope={ageScope()} />}
                    </Show>
                    <Show when={blocking()}>
                      {(message) => (
                        <p
                          class="user-calculator-card__blocking"
                          data-testid="user-calculator-blocking"
                        >
                          Не готов: {message()}
                        </p>
                      )}
                    </Show>
                    <Button
                      type="button"
                      class="user-calculator-card__open"
                      disabled={blocking() !== null}
                      title={blocking() ?? 'Открыть калькулятор'}
                      data-testid="user-calculator-open"
                      onClick={() => props.onOpen(model)}
                      icon={<AppGlyph name="calculator" class="user-calculators__icon" />}
                    >
                      Открыть
                    </Button>
                  </article>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>

      <OverlayDialog
        open={importOpen()}
        title="Импорт калькулятора"
        class="user-calculators__import-dialog"
        bodyClass="user-calculators__import-body"
        onClose={() => setImportOpen(false)}
      >
        <FileDropZone
          accept=".json,.minimed-calculator,application/vnd.minimed.calculator+json,application/json"
          title="Файл калькулятора MiniMed"
          onFile={importFile}
        />
        <p class="user-calculators__import-text">
          Подходит файл, который вы или коллега выгрузили кнопкой «Экспорт» у своего калькулятора.
          Это JSON-файл: название, входные данные, формула и диапазоны результата. Импортированный
          калькулятор появится в списке, его можно будет изменить.
        </p>
        <pre class="user-calculators__import-example">{`{
  "format": "minimed-calculator",
  "version": 1,
  "title": "ИМТ",
  "inputs": [
    { "name": "масса", "label": "Масса", "unit": "кг" },
    { "name": "рост", "label": "Рост", "unit": "см" }
  ],
  "formula": "масса / (рост / 100) ^ 2",
  "result": { "label": "ИМТ", "unit": "кг/м²", "decimals": 1 }
}`}</pre>
      </OverlayDialog>

      <ConfirmationDialog
        open={pendingDelete() !== undefined}
        title="Удалить калькулятор?"
        description={`«${pendingDelete()?.title ?? ''}» будет удалён с этого устройства. Это действие нельзя отменить; уже сохранённые расчёты останутся в истории.`}
        confirmLabel="Удалить"
        danger
        onConfirm={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(undefined);
        }}
      />
    </div>
  );
}
