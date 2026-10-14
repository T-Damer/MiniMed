import { createResource, For, type JSX, Show } from 'solid-js';

import { OverlayDialog } from '@/components/OverlayDialog';
import {
  atcCatalogCitation,
  atcFillSourceLabel,
  atcLadder,
  atcNameSourceLabel,
  normalizeAtcCode,
} from '@/features/medications/atc-code';
import { loadAtcNames } from '@/features/medications/atc-names';
import { type DrugAtcCode, drugAtcCodeLabel } from '@/features/medications/drug-screen';

import '@/features/medications/drug-screen.css';

/**
 * A code explained level by level. Levels 1-4 are named by the NSI «АТХ» dictionary, a lazy chunk
 * fetched when the sheet first opens; if it cannot load, the names the drug's own data carries are
 * shown and the sheet says so. A level without a name says so; nothing is invented.
 */
export function AtcCodeSheet(props: {
  readonly code: DrugAtcCode | undefined;
  readonly open: boolean;
  readonly onClose: () => void;
}): JSX.Element {
  const [catalog] = createResource(() => (props.open ? true : undefined), loadAtcNames);
  const steps = () => {
    const code = props.code;
    const normalized = code ? normalizeAtcCode(code.code) : null;
    return code && normalized
      ? atcLadder({
          code: normalized,
          catalog: catalog(),
          // The group text of the node describes the registry's stub, not a consensus code's levels.
          groupText: code.consensusSources.length > 0 ? null : code.groupText,
          substanceName: code.substanceName,
        })
      : [];
  };
  return (
    <OverlayDialog
      open={props.open}
      title={`Код АТХ ${props.code?.code ?? ''}`.trim()}
      subtitle="Анатомо-терапевтическо-химическая классификация"
      class="atc-sheet"
      onClose={props.onClose}
    >
      <Show when={props.code}>
        {(code) => (
          <div class="atc-sheet__content">
            <p class="atc-sheet__intro">
              Каждая следующая часть кода уточняет предыдущую: от группы органов и систем до
              конкретного вещества.
            </p>
            <ol class="atc-sheet__steps" aria-label="Уровни кода">
              <For each={steps()}>
                {(step) => (
                  <li
                    class={`atc-sheet__step atc-sheet__step--level-${String(step.level)}`}
                    classList={{ 'atc-sheet__step--absent': step.code === null }}
                  >
                    <span class="atc-sheet__code">{step.code ?? '—'}</span>
                    <span class="atc-sheet__text">
                      <span class="atc-sheet__role">
                        {step.level}. {step.role}
                      </span>
                      <Show
                        when={step.name}
                        fallback={
                          <span class="atc-sheet__missing">
                            {step.code === null
                              ? 'Источник не уточняет код до этого уровня.'
                              : catalog.loading
                                ? 'Названия загружаются…'
                                : 'Название в загруженных данных отсутствует.'}
                          </span>
                        }
                      >
                        {(name) => (
                          <>
                            <span class="atc-sheet__name">{name()}</span>
                            <Show when={step.nameSource}>
                              {(source) => (
                                <span class="atc-sheet__source">
                                  {atcNameSourceLabel(source())}
                                </span>
                              )}
                            </Show>
                          </>
                        )}
                      </Show>
                    </span>
                  </li>
                )}
              </For>
            </ol>
            <Show when={code().groupText}>
              {(group) => (
                <p class="atc-sheet__note">
                  <span class="atc-sheet__note-label">Группа в ЕСКЛП:</span> {group()}
                </p>
              )}
            </Show>
            <Show when={catalog.error}>
              <p class="atc-sheet__note">
                Справочник названий АТХ не загрузился: показаны только названия из данных препарата.
              </p>
            </Show>
            <Show when={code().sourceCode}>
              {(sourceCode) => (
                <p class="atc-sheet__note">
                  В источнике код записан как «{sourceCode()}»: похожие кириллические буквы заменены
                  латинскими.
                </p>
              )}
            </Show>
            <Show when={code().consensusSources.length > 0}>
              <p class="atc-sheet__note" data-testid="atc-consensus-note">
                <span class="atc-sheet__note-label">Основной код:</span> источники совпали —{' '}
                {code().consensusSources.map(atcFillSourceLabel).join(', ')}.{' '}
                <span class="atc-sheet__note-label">В реестре:</span>{' '}
                {drugAtcCodeLabel(code()).registryCode ?? 'код не указан'} (только группа).
              </p>
            </Show>
            <Show when={code().fillSources.length > 0}>
              <p class="atc-sheet__note">
                <span class="atc-sheet__note-label">Код дополнен:</span>{' '}
                {code().fillSources.map(atcFillSourceLabel).join(', ')}. В ЕСКЛП:{' '}
                {code().registryValue && code().registryValue !== '~'
                  ? `«${code().registryValue ?? ''}»`
                  : 'код не указан'}
                .
              </p>
            </Show>
            <Show when={code().alternatives.length > 0}>
              <p class="atc-sheet__note">
                <span class="atc-sheet__note-label">Источники расходятся:</span>{' '}
                {code()
                  .alternatives.map(
                    (item) => `${item.code} (${item.sources.map(atcFillSourceLabel).join(', ')})`,
                  )
                  .join('; ')}
                .
              </p>
            </Show>
            <p class="atc-sheet__footer">
              {code().consensusSources.length > 0
                ? 'Основной код АТХ уточнён по данным MiniMed; значение ЕСКЛП не менялось. '
                : code().fillSources.length > 0
                  ? 'Код АТХ дополнен по данным MiniMed. '
                  : code().edition
                    ? `Код АТХ по ЕСКЛП от ${code().edition}. `
                    : 'Код АТХ по ЕСКЛП. '}
              <Show when={catalog()}>
                {(names) => (
                  <>
                    Названия уровней 1–4: {atcCatalogCitation(names())}; разработан на основе данных
                    Сотрудничающего центра ВОЗ по методологии статистики лекарственных средств,
                    Осло.{' '}
                  </>
                )}
              </Show>
              Названия, которых нет в справочнике и в данных препарата, не подставляются.
            </p>
          </div>
        )}
      </Show>
    </OverlayDialog>
  );
}
