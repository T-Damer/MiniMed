import { For, type JSX, Show } from 'solid-js';

import { OverlayDialog } from '@/components/OverlayDialog';
import { atcLadder, atcNameSourceLabel, normalizeAtcCode } from '@/features/medications/atc-code';
import type { DrugAtcCode } from '@/features/medications/drug-screen';

import '@/features/medications/drug-screen.css';

/**
 * A code explained level by level, from the names the loaded data actually has. A level without a
 * name says so; nothing is filled in from outside the source.
 */
export function AtcCodeSheet(props: {
  readonly code: DrugAtcCode | undefined;
  readonly open: boolean;
  readonly onClose: () => void;
}): JSX.Element {
  const steps = () => {
    const code = props.code;
    const normalized = code ? normalizeAtcCode(code.code) : null;
    return code && normalized
      ? atcLadder({
          code: normalized,
          groupText: code.groupText,
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
            <Show when={code().sourceCode}>
              {(sourceCode) => (
                <p class="atc-sheet__note">
                  В источнике код записан как «{sourceCode()}»: похожие кириллические буквы заменены
                  латинскими.
                </p>
              )}
            </Show>
            <p class="atc-sheet__footer">
              {code().edition ? `Код АТХ по ЕСКЛП от ${code().edition}. ` : 'Код АТХ по ЕСКЛП. '}
              Названия, которых нет в загруженных данных, не подставляются из других источников.
            </p>
          </div>
        )}
      </Show>
    </OverlayDialog>
  );
}
