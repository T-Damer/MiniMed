import type { MedicalCore } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, onMount, Show } from 'solid-js';

import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchHistoryPanel } from '@/features/history/SearchHistoryPanel';
import { GroundedAssistantStatus } from '@/features/models/GroundedAssistantStatus';
import type { GroundedMedicalCore } from '@/features/models/GroundedMedicalCore';
import {
  documentMatchesSearchScope,
  ScopedMedicalCore,
  type SearchScope,
} from '@/features/search/ScopedMedicalCore';
import { SearchWorkspace } from '@/features/search/SearchWorkspace';

interface SearchHomeProps {
  readonly baseCore: MedicalCore;
  readonly assistantCore?: GroundedMedicalCore | undefined;
  readonly onOpenKnowledgeBase: () => void;
}

interface SearchScopeOption {
  readonly id: SearchScope;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
}

const STORAGE_KEY = 'minimed.search-scope.v1';

const SEARCH_SCOPES: readonly SearchScopeOption[] = [
  {
    id: 'diagnosis',
    label: 'Диагностировать',
    shortLabel: 'Диагноз',
    description: 'Разобрать клинический случай и проверить кандидатов по локальным источникам.',
  },
  {
    id: 'guidelines',
    label: 'В клин. рекомендациях',
    shortLabel: 'КР',
    description: 'Искать только в установленных клинических рекомендациях.',
  },
  {
    id: 'medications',
    label: 'Препараты',
    shortLabel: 'Препараты',
    description: 'Искать в реестровых карточках и официальных инструкциях.',
  },
  {
    id: 'legal',
    label: 'Правовые документы',
    shortLabel: 'Право',
    description: 'Искать только в установленных нормативных и организационных документах.',
  },
  {
    id: 'all',
    label: 'Всё без диагностики',
    shortLabel: 'Все источники',
    description: 'Обычный локальный поиск по всем установленным источникам без генерации.',
  },
] as const;

function isSearchScope(value: string | null): value is SearchScope {
  return SEARCH_SCOPES.some((option) => option.id === value);
}

function loadStoredScope(): SearchScope | undefined {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isSearchScope(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function SearchHome(props: SearchHomeProps): JSX.Element {
  const [scope, setScope] = createSignal<SearchScope>();
  const [documentCounts, setDocumentCounts] = createSignal<Readonly<Record<SearchScope, number>>>({
    diagnosis: 0,
    guidelines: 0,
    medications: 0,
    legal: 0,
    all: 0,
  });
  const [helpOpen, setHelpOpen] = createSignal(false);

  onMount(() => {
    setScope(loadStoredScope());
    void props.baseCore.listDocuments().then((result) => {
      if (!result.ok) return;
      const all = result.value.length;
      setDocumentCounts({
        diagnosis: all,
        all,
        guidelines: result.value.filter((document) =>
          documentMatchesSearchScope(document, 'guidelines'),
        ).length,
        medications: result.value.filter((document) =>
          documentMatchesSearchScope(document, 'medications'),
        ).length,
        legal: result.value.filter((document) => documentMatchesSearchScope(document, 'legal')).length,
      });
    });
  });

  const selectedOption = createMemo(() =>
    SEARCH_SCOPES.find((option) => option.id === scope()),
  );
  const scopedCore = createMemo(() => {
    const selected = scope();
    return selected
      ? new ScopedMedicalCore(props.baseCore, props.assistantCore, selected)
      : undefined;
  });
  const selectedScopeUnavailable = createMemo(() => {
    const selected = scope();
    return Boolean(
      selected &&
        selected !== 'diagnosis' &&
        selected !== 'all' &&
        documentCounts()[selected] === 0,
    );
  });

  const selectScope = (next: SearchScope): void => {
    setScope(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Search remains available when browser storage is disabled.
    }
  };

  return (
    <section class="search-home" aria-label="Поиск MiniMed">
      <header class="search-mode-heading">
        <div>
          <p class="archive-kicker">Сначала выберите задачу</p>
          <h1>Что вы хотите найти?</h1>
          <p>
            Режим определяет, какие источники участвуют в выдаче и можно ли подключать локальную
            модель.
          </p>
        </div>
        <Show when={scope() === 'diagnosis'}>
          <button
            class="search-mode-help"
            type="button"
            aria-label="Как работает диагностический режим"
            onClick={() => setHelpOpen(true)}
          >
            ?
          </button>
        </Show>
      </header>

      <div class="search-mode-picker" role="radiogroup" aria-label="Режим поиска">
        <For each={SEARCH_SCOPES}>
          {(option) => (
            <button
              type="button"
              role="radio"
              aria-checked={scope() === option.id}
              classList={{ active: scope() === option.id }}
              title={option.description}
              onClick={() => selectScope(option.id)}
            >
              <strong>{option.label}</strong>
              <small>
                {documentCounts()[option.id]} {option.id === 'diagnosis' ? 'источников' : 'док.'}
              </small>
            </button>
          )}
        </For>
      </div>

      <Show
        when={scopedCore()}
        fallback={
          <div class="search-locked-state paper-card">
            <strong>Поле поиска откроется после выбора режима</strong>
            <p>
              Для клинического случая выберите «Диагностировать». Для точного справочного поиска —
              нужный тип источника.
            </p>
          </div>
        }
      >
        {(activeCore) => (
          <>
            <div class="search-selected-mode" aria-live="polite">
              <span>{selectedOption()?.shortLabel}</span>
              <p>{selectedOption()?.description}</p>
              <button type="button" onClick={() => setScope(undefined)}>
                Сменить
              </button>
            </div>

            <Show when={selectedScopeUnavailable()}>
              <div class="search-scope-unavailable paper-card">
                <div>
                  <strong>Такие документы ещё не установлены</strong>
                  <p>Откройте базу знаний и скачайте подходящий раздел. Остальные режимы работают.</p>
                </div>
                <button type="button" onClick={props.onOpenKnowledgeBase}>
                  Открыть базу знаний
                </button>
              </div>
            </Show>

            <div class="search-workspace-grid">
              <div class="search-workspace-main">
                <Show when={scope() === 'diagnosis' && props.assistantCore}>
                  <GroundedAssistantStatus assistant={props.assistantCore as GroundedMedicalCore} />
                </Show>
                <SearchWorkspace core={activeCore()} />
              </div>
              <SearchHistoryPanel />
            </div>
          </>
        )}
      </Show>

      <OverlayDialog
        open={helpOpen()}
        title="Диагностический режим"
        subtitle="Локальная поддержка решения, а не автоматический диагноз"
        class="diagnosis-help-dialog"
        onClose={() => setHelpOpen(false)}
      >
        <div class="diagnosis-help-copy">
          <p>
            MiniMed сначала ищет подходящие фрагменты в установленных источниках. Локальная модель
            может затем выделить диагностические кандидаты, уточняющие вопросы и подтверждённые
            выдержки.
          </p>
          <ul>
            <li>Модель работает на устройстве и может ошибаться.</li>
            <li>Ответ без точной ссылки на установленный источник не считается подтверждённым.</li>
            <li>При сбое модели остаётся обычный детерминированный поиск.</li>
            <li>Результат не заменяет осмотр, клиническое мышление и ответственность врача.</li>
          </ul>
        </div>
      </OverlayDialog>
    </section>
  );
}
