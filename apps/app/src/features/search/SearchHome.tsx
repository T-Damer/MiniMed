import type { MedicalCore } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import brainDownloadIcon from '@/assets/brainDownload.svg';
import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchHistoryPanel } from '@/features/history/SearchHistoryPanel';
import type { LocalModelController } from '@/features/models/controller';
import { GroundedAssistantStatus } from '@/features/models/GroundedAssistantStatus';
import type {
  GroundedAssistantState,
  GroundedMedicalCore,
} from '@/features/models/GroundedMedicalCore';
import {
  documentMatchesSearchScope,
  ScopedMedicalCore,
  type SearchScope,
} from '@/features/search/ScopedMedicalCore';
import { type SearchEnhancementState, SearchWorkspace } from '@/features/search/SearchWorkspace';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { replaySearch, type SearchHistoryEntry } from '@/state/search-history';

interface SearchHomeProps {
  readonly baseCore: MedicalCore;
  readonly assistantCore?: GroundedMedicalCore | undefined;
  readonly localModelController: LocalModelController;
  readonly active: boolean;
  readonly onOpenKnowledgeBase: () => void;
  readonly onOpenModelSettings: () => void;
  readonly appUpdateReady?: boolean;
  readonly appUpdating?: boolean;
  readonly onActivateAppUpdate?: () => void;
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
    shortLabel: 'КР и нормы',
    description: 'Искать в клинических рекомендациях, медицинских нормах и формулах.',
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

const AI_ASSIST_KEY = 'minimed.diagnosis-ai-assist.v1';

function loadAiAssistPreference(): boolean {
  try {
    return window.localStorage.getItem(AI_ASSIST_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveAiAssistPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(AI_ASSIST_KEY, enabled ? 'on' : 'off');
  } catch {
    // Best effort — the toggle still works for the current session.
  }
}

export function SearchHome(props: SearchHomeProps): JSX.Element {
  const [scope, setScope] = createSignal<SearchScope>();
  const [documentCountsLoaded, setDocumentCountsLoaded] = createSignal(false);
  const [documentCounts, setDocumentCounts] = createSignal<Readonly<Record<SearchScope, number>>>({
    diagnosis: 0,
    guidelines: 0,
    medications: 0,
    legal: 0,
    all: 0,
  });
  const [helpOpen, setHelpOpen] = createSignal(false);
  const [aiAssistEnabled, setAiAssistEnabled] = createSignal(loadAiAssistPreference());
  const [assistantState, setAssistantState] = createSignal<GroundedAssistantState>();
  const [localModelReady, setLocalModelReady] = createSignal(
    props.localModelController.canRunStructuredTasks(),
  );
  const [hasSearchScroll, setHasSearchScroll] = createSignal(false);

  const toggleAiAssist = (): void => {
    setAiAssistEnabled((previous) => {
      const next = !previous;
      saveAiAssistPreference(next);
      return next;
    });
  };

  onMount(() => {
    const updateSearchScroll = (): void => {
      setHasSearchScroll(window.scrollY > 1);
    };
    updateSearchScroll();
    window.addEventListener('scroll', updateSearchScroll, { passive: true });
    onCleanup(() => window.removeEventListener('scroll', updateSearchScroll));

    const unsubscribeModel = props.localModelController.subscribe(() => {
      setLocalModelReady(props.localModelController.canRunStructuredTasks());
    });
    onCleanup(unsubscribeModel);

    if (!props.assistantCore) return;
    const unsubscribe = props.assistantCore.subscribeAssistant(setAssistantState);
    onCleanup(unsubscribe);
  });

  const enhancement = createMemo((): SearchEnhancementState | undefined => {
    if (!aiAssistEnabled() || scope() !== 'diagnosis') return undefined;
    const state = assistantState();
    if (!state || state.phase === 'idle' || !state.query) return undefined;
    return {
      phase: state.phase,
      query: state.query,
      enhancedResponse: state.enhancedResponse,
    };
  });

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

  const scopedCore = createMemo(() => {
    const selected = scope();
    const assistant = aiAssistEnabled() ? props.assistantCore : undefined;
    return selected ? new ScopedMedicalCore(props.baseCore, assistant, selected) : undefined;
  });
  const selectedScopeUnavailable = createMemo(() => {
    const selected = scope();
    return Boolean(selected && documentCountsLoaded() && documentCounts()[selected] === 0);
  });

  const selectScope = (next: SearchScope): void => {
    setScope(next);
  };

  const replayHistory = (entry: SearchHistoryEntry): void => {
    selectScope(entry.scope);
    requestAnimationFrame(() => replaySearch(entry));
  };

  return (
    <section class="search-home page-grain" aria-label="Поиск MiniMed">
      <div
        class="search-home__backdrop-blur masked-backdrop-blur"
        classList={{ 'search-home__backdrop-blur--visible': hasSearchScroll() }}
        aria-hidden="true"
      />
      <div class="search-mode-tools">
        <Show when={props.active}>
          <SearchHistoryPanel onReplay={replayHistory} />
        </Show>
        <Show when={props.appUpdateReady}>
          <button
            class="search-update-status"
            type="button"
            disabled={props.appUpdating}
            aria-label={props.appUpdating ? 'Обновляем приложение' : 'Обновить приложение'}
            title={props.appUpdating ? 'Обновляем приложение' : 'Обновить приложение'}
            onClick={props.onActivateAppUpdate}
          >
            <AppGlyph name="refresh" class="search-update-status__icon" />
            <span>{props.appUpdating ? 'Проверка…' : 'Обновить'}</span>
          </button>
        </Show>
        <button
          class="search-mode-help"
          type="button"
          aria-label="Как работает диагностический режим"
          onClick={() => setHelpOpen(true)}
        >
          ?
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

      <div class="search-workspace-main">
        <SearchWorkspace
          core={scopedCore() ?? props.baseCore}
          scope={scope() ?? 'all'}
          searchAllowed={Boolean(scope()) && !selectedScopeUnavailable()}
          enhancement={enhancement}
          resultsHeader={
            <Show when={scope() === 'diagnosis' && aiAssistEnabled() && props.assistantCore}>
              <GroundedAssistantStatus assistant={props.assistantCore as GroundedMedicalCore} />
            </Show>
          }
          queryActionsExtra={
            <Show when={scope() === 'diagnosis'}>
              <button
                type="button"
                class="ai-assist-toggle"
                classList={{
                  active: localModelReady() && aiAssistEnabled(),
                  'ai-assist-toggle--download': !localModelReady(),
                }}
                aria-label={
                  localModelReady()
                    ? aiAssistEnabled()
                      ? 'Выключить локальную модель'
                      : 'Включить локальную модель'
                    : 'Загрузить локальную модель'
                }
                aria-pressed={localModelReady() ? aiAssistEnabled() : undefined}
                title={
                  localModelReady()
                    ? aiAssistEnabled()
                      ? 'Локальная модель включена: разбирает запрос и уточняет порядок источников'
                      : 'Локальная модель выключена: обычный детерминированный поиск'
                    : 'Загрузить локальную модель для AI-поиска'
                }
                onClick={() => (localModelReady() ? toggleAiAssist() : props.onOpenModelSettings())}
              >
                <Show
                  when={localModelReady()}
                  fallback={
                    <img
                      class="ai-assist-toggle__icon"
                      src={brainDownloadIcon}
                      alt="ai-assist-toggle"
                      aria-hidden="true"
                    />
                  }
                >
                  <AppGlyph class="ai-assist-toggle__icon" name="brain" />
                </Show>
                <span class="sr-only">
                  {localModelReady()
                    ? aiAssistEnabled()
                      ? 'Выключить локальную модель'
                      : 'Включить локальную модель'
                    : 'Загрузить локальную модель'}
                </span>
              </button>
            </Show>
          }
          placeholder={
            scope()
              ? 'Например: 5 лет, мальчик, второй день кашляет и температурит…'
              : 'Выберите режим поиска'
          }
          modePicker={
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
                      aria-label={option.label}
                      checked={scope() === option.id}
                      disabled={documentCountsLoaded() && documentCounts()[option.id] === 0}
                      onChange={() => selectScope(option.id)}
                    />
                    <span class="search-mode-option-copy">
                      <strong>{option.shortLabel}</strong>
                      <small>{documentCounts()[option.id]}</small>
                    </span>
                  </label>
                )}
              </For>
            </fieldset>
          }
        />
      </div>

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
