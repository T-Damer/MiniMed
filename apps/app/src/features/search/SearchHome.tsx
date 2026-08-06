import type { MedicalCore } from '@localmed/contracts';
import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';

import { OverlayDialog } from '@/components/OverlayDialog';
import { SearchHistoryPanel } from '@/features/history/SearchHistoryPanel';
import { MedicationInteractionChecker } from '@/features/interactions/MedicationInteractionChecker';
import { GroundedAssistantStatus } from '@/features/models/GroundedAssistantStatus';
import type { GroundedMedicalCore } from '@/features/models/GroundedMedicalCore';
import {
  documentMatchesSearchScope,
  ScopedMedicalCore,
  type SearchScope,
} from '@/features/search/ScopedMedicalCore';
import { SearchWorkspace } from '@/features/search/SearchWorkspace';
import { canSelectSearchScope } from '@/features/search/search-scope-availability';
import { CONTENT_CHANGED_EVENT } from '@/state/content-events';
import { replaySearch, type SearchHistoryEntry } from '@/state/search-history';

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
  const [detectedMedicationNames, setDetectedMedicationNames] = createSignal<readonly string[]>([]);

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
    return selected
      ? new ScopedMedicalCore(props.baseCore, props.assistantCore, selected)
      : undefined;
  });
  const selectedScopeUnavailable = createMemo(() => {
    const selected = scope();
    return Boolean(selected && documentCountsLoaded() && documentCounts()[selected] === 0);
  });
  const scopeSelectable = (candidate: SearchScope): boolean =>
    canSelectSearchScope(candidate, documentCountsLoaded(), documentCounts()[candidate]);

  const selectScope = (next: SearchScope): void => {
    setScope(next);
    if (next !== 'medications') setDetectedMedicationNames([]);
  };

  const replayHistory = (entry: SearchHistoryEntry): void => {
    selectScope(entry.scope);
    requestAnimationFrame(() => replaySearch(entry));
  };

  return (
    <section class="search-home" aria-label="Поиск MiniMed">
      <div class="search-mode-tools">
        <SearchHistoryPanel onReplay={replayHistory} />
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
      </div>

      <Show when={selectedScopeUnavailable()}>
        <output class="search-scope-unavailable paper-card">
          <div>
            <strong>
              {scope() === 'medications'
                ? 'Инструкции препаратов ещё не установлены'
                : 'Такие документы ещё не установлены'}
            </strong>
            <p>
              {scope() === 'medications'
                ? 'Проверка взаимодействий доступна ниже. Для поиска по инструкциям установите подходящий раздел базы знаний.'
                : 'Откройте базу знаний и скачайте подходящий раздел. Остальные режимы работают.'}
            </p>
          </div>
          <button type="button" onClick={props.onOpenKnowledgeBase}>
            Открыть базу знаний
          </button>
        </output>
      </Show>

      <div class="search-workspace-main">
        <Show when={scope() === 'diagnosis' && props.assistantCore}>
          <GroundedAssistantStatus assistant={props.assistantCore as GroundedMedicalCore} />
        </Show>
        <Show when={scope() === 'medications'}>
          <MedicationInteractionChecker detectedMedicationNames={detectedMedicationNames()} />
        </Show>
        <SearchWorkspace
          core={scopedCore() ?? props.baseCore}
          scope={scope() ?? 'all'}
          searchAllowed={Boolean(scope()) && !selectedScopeUnavailable()}
          placeholder={
            scope()
              ? 'Например: 5 лет, мальчик, второй день кашляет и температурит…'
              : 'Выберите режим поиска'
          }
          onAnalysis={(analysis) => {
            if (scope() !== 'medications') return;
            setDetectedMedicationNames(
              analysis.facts
                .filter((fact) => fact.kind === 'medication' && fact.polarity !== 'negative')
                .map((fact) => fact.value),
            );
          }}
          modePicker={
            <fieldset class="search-mode-picker">
              <legend class="visually-hidden">Режим поиска</legend>
              <For each={SEARCH_SCOPES}>
                {(option) => (
                  <label
                    classList={{
                      active: scope() === option.id,
                      unavailable: !scopeSelectable(option.id),
                    }}
                    title={option.description}
                  >
                    <input
                      type="radio"
                      name="minimed-search-scope"
                      value={option.id}
                      aria-label={option.label}
                      checked={scope() === option.id}
                      disabled={!scopeSelectable(option.id)}
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
