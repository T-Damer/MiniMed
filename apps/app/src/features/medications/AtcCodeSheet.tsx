import { createEffect, createResource, For, type JSX, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { OverlayDialog } from '@/components/OverlayDialog';
import {
  type AtcLadderStep,
  atcCatalogCitation,
  atcFillSourceLabel,
  atcNameSourceLabel,
} from '@/features/medications/atc-code';
import { loadAtcNames } from '@/features/medications/atc-names';
import { atcSheetSections } from '@/features/medications/atc-sheet-model';
import { atcSubstanceName } from '@/features/medications/atc-substance-name';
import { type DrugAtcCode, drugAtcCodeLabel } from '@/features/medications/drug-screen';
import { openAtcGroup } from '@/features/medications/medication-navigation';

import '@/features/medications/drug-screen.css';

/** Which ladder of a two-code drug the user tapped: the agreed code, or the registry's own stub. */
export type AtcSheetFocus = 'main' | 'registry';

/**
 * A code explained level by level, each level a link to the drugs of its group (ATC5). Levels 1-4 are named by the NSI «АТХ» dictionary, a lazy chunk
 * fetched when the sheet first opens; if it cannot load, the names the drug's own data carries are
 * shown and the sheet says so. A level without a name says so; nothing is invented.
 */
export function AtcCodeSheet(props: {
  readonly code: DrugAtcCode | undefined;
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * `drug`: the code of a drug card, with the history of how it was filled. `text`: a code met in a
   * document, which has only its levels (and the substances that carry the full code).
   */
  readonly origin?: 'drug' | 'text';
  /** The ladder to highlight when the drug has two (an agreed code and the registry's stub). */
  readonly focus?: AtcSheetFocus;
}): JSX.Element {
  const [catalog] = createResource(() => (props.open ? true : undefined), loadAtcNames);
  // A code without a drug behind it names its level 5 by the substances that have it.
  const [substance] = createResource(
    () =>
      props.open && props.code && props.code.substanceName === null ? props.code.code : undefined,
    atcSubstanceName,
  );
  const sections = () =>
    props.code
      ? atcSheetSections({ code: props.code, catalog: catalog(), substanceName: substance() })
      : [];
  const focusKey = (): AtcSheetFocus => props.focus ?? 'main';
  /** The code the user tapped: the sheet is titled by it and its ladder is the highlighted one. */
  const focusCode = (): string => {
    const code = props.code;
    if (!code) return '';
    return focusKey() === 'registry'
      ? (drugAtcCodeLabel(code).registryCode ?? code.code)
      : code.code;
  };
  const ladders = new Map<string, HTMLElement>();
  createEffect(() => {
    if (!props.open || focusKey() !== 'registry' || sections().length < 2) return;
    // After the sheet has mounted its content: the tapped ladder comes into view.
    window.setTimeout(() => ladders.get('registry')?.scrollIntoView({ block: 'nearest' }), 0);
  });
  const openLevel = (step: AtcLadderStep): void => {
    if (step.code === null) return;
    // The group is a page of its own on top of the sheet's entry; the sheet closes with the
    // navigation (history layers, state/history-layer.ts), and back from the group returns to the
    // screen under the sheet in one press.
    openAtcGroup(step.code);
  };
  return (
    <OverlayDialog
      open={props.open}
      title={`Код АТХ ${focusCode()}`.trim()}
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
            <For each={sections()}>
              {(section) => (
                <section
                  ref={(element) => {
                    ladders.set(section.key, element);
                  }}
                  class="atc-sheet__ladder"
                  classList={{
                    'atc-sheet__ladder--focus': sections().length > 1 && section.key === focusKey(),
                  }}
                  data-testid={`atc-ladder-${section.key}`}
                  data-focus={section.key === focusKey() ? 'true' : undefined}
                >
                  <Show when={section.heading}>
                    {(heading) => <h3 class="atc-sheet__ladder-heading">{heading()}</h3>}
                  </Show>
                  <ol class="atc-sheet__steps" aria-label="Уровни кода">
                    <For each={section.steps}>
                      {(step) => (
                        <li
                          class={`atc-sheet__step-item atc-sheet__step-item--level-${String(step.level)}`}
                        >
                          <Show
                            when={step.code}
                            fallback={
                              <div class="atc-sheet__step atc-sheet__step--absent">
                                <span class="atc-sheet__code">—</span>
                                <span class="atc-sheet__text">
                                  <span class="atc-sheet__role">
                                    {step.level}. {step.role}
                                  </span>
                                  <span class="atc-sheet__missing">
                                    Источник не уточняет код до этого уровня.
                                  </span>
                                </span>
                              </div>
                            }
                          >
                            {(stepCode) => (
                              <button
                                type="button"
                                class="atc-sheet__step atc-sheet__step--link"
                                data-testid="atc-level"
                                data-code={stepCode()}
                                aria-label={`${stepCode()}: показать препараты группы`}
                                onClick={() => openLevel(step)}
                              >
                                <span class="atc-sheet__code">{stepCode()}</span>
                                <span class="atc-sheet__text">
                                  <span class="atc-sheet__role">
                                    {step.level}. {step.role}
                                  </span>
                                  <Show when={step.name}>
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
                                <AppGlyph name="caret-right" class="atc-sheet__step-chevron" />
                              </button>
                            )}
                          </Show>
                        </li>
                      )}
                    </For>
                  </ol>
                </section>
              )}
            </For>
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
              {props.origin === 'text'
                ? ''
                : code().consensusSources.length > 0
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
              Названия, которых нет в справочнике, не подставляются.
            </p>
          </div>
        )}
      </Show>
    </OverlayDialog>
  );
}
