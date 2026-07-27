import type { MedicalCore } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchHistoryPanel } from '@/features/history/SearchHistoryPanel';
import { GroundedAssistantStatus } from '@/features/models/GroundedAssistantStatus';
import type { GroundedMedicalCore } from '@/features/models/GroundedMedicalCore';
import {
  documentMatchesSearchScope,
  inferSearchScope,
  ScopedMedicalCore,
  type SearchScope,
} from '@/features/search/ScopedMedicalCore';
import { SearchWorkspace } from '@/features/search/SearchWorkspace';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';

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

export function SearchHome(props: SearchHomeProps): JSX.Element {
  const [scope, setScope] = createSignal<SearchScope>();
  const [manualScope, setManualScope] = createSignal(false);
  const [scopePromptOpen, setScopePromptOpen] = createSignal(false);
  const [documentCountsLoaded, setDocumentCountsLoaded] = createSignal(false);
  const [documentCounts, setDocumentCounts] = createSignal<Readonly<Record<SearchScope, number>>>({
    diagnosis: 0,
    guidelines: 0,
    medications: 0,
    legal: 0,
    all: 0,
  });
  const [helpOpen, setHelpOpen] = createSignal(false);

  const refreshDocumentCounts = (): void => {
    void props.baseCore.listDocuments().then((result) => {
      if (result.ok) {
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
          legal: result.value.filter((document) => documentMatchesSearchScope(document, 'legal'))
            .length,
        });
      }
      setDocumentCountsLoaded(true);
    });
  };

  onMount(() => {
    refreshDocumentCounts();
    window.addEventListener(CONTENT_CHANGED_EVENT, refreshDocumentCounts);
  });
  onCleanup(() => window.removeEventListener(CONTENT_CHANGED_EVENT, refreshDocumentCounts));

  const selectedOption = createMemo(() => SEARCH_SCOPES.find((option) => option.id === scope()));
  const scopedCore = createMemo(() => {
    const selected = scope();
    return selected
      ? new ScopedMedicalCore(props.baseCore, props.assistantCore, selected)
      : undefined;
  });
  const selectedScopeUnavailable = createMemo(() => {
    const selected = scope();
    return Boolean(selected && documentCountsLoaded() && documentCounts()[selected] === 0);
  });

  const selectScope = (next: SearchScope, manual = true): void => {
    setScope(next);
    setManualScope(manual);
    setScopePromptOpen(false);
  };

  const detectScope = (analysis: Parameters<typeof inferSearchScope>[0]): void => {
    if (manualScope()) return;
    const detected = inferSearchScope(analysis);
    setScope(detected);
    setScopePromptOpen(!detected);
  };

  return (
    <section class="search-home" aria-label="Поиск MiniMed">
      <header class="search-mode-heading">
        <div>
          <p class="archive-kicker">Режим определяется по запросу</p>
          <h1>Что вы хотите найти?</h1>
          <p>
            MiniMed выберет подходящие локальные источники. Если запрос неоднозначен, попросит
            уточнить раздел.
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

      <Show when={scopePromptOpen()}>
        <div class="search-scope-prompt paper-card" role="status">
          <strong>В каком разделе искать?</strong>
          <p>Запрос подходит сразу к нескольким режимам. Выберите нужный раздел.</p>
        </div>
        <fieldset class="search-mode-picker">
          <legend class="visually-hidden">Режим поиска</legend>
          <For each={SEARCH_SCOPES}>
            {(option) => (
              <label
                classList={{
                  active: scope() === option.id,
                  unavailable: documentCountsLoaded() && documentCounts()[option.id] === 0,
                }}
                title={option.description}
              >
                <input
                  type="radio"
                  name="minimed-search-scope"
                  value={option.id}
                  checked={scope() === option.id}
                  disabled={documentCountsLoaded() && documentCounts()[option.id] === 0}
                  onChange={() => selectScope(option.id)}
                />
                <span class="search-mode-option-copy">
                  <strong>{option.label}</strong>
                  <small>{documentCounts()[option.id]} док.</small>
                </span>
              </label>
            )}
          </For>
        </fieldset>
      </Show>

      <Show when={scope()}>
        <>
          <div class="search-selected-mode" aria-live="polite">
            <span>
              {manualScope()
                ? selectedOption()?.shortLabel
                : `Авто · ${selectedOption()?.shortLabel}`}
            </span>
            <p>{selectedOption()?.description}</p>
            <button
              type="button"
              onClick={() => {
                setManualScope(false);
                setScope(undefined);
                setScopePromptOpen(true);
              }}
            >
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
        </>
      </Show>

      <div class="search-workspace-main">
        <Show when={scope() === 'diagnosis' && props.assistantCore}>
          <GroundedAssistantStatus assistant={props.assistantCore as GroundedMedicalCore} />
        </Show>
        <SearchWorkspace
          core={scopedCore() ?? props.baseCore}
          searchAllowed={Boolean(scopedCore()) && !selectedScopeUnavailable()}
          onAnalysis={(analysis) => detectScope(analysis.intent)}
        />
      </div>
      <SearchHistoryPanel />

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
