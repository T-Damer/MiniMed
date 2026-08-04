import { createEffect, createMemo, createSignal, For, type JSX, Show } from 'solid-js';

import { AppGlyph } from '@/components/AppGlyph';
import {
  checkMedicationInteractions,
  extractMedicationNames,
} from '@/features/interactions/interaction-engine';
import { MEDICATION_INTERACTION_KNOWLEDGE } from '@/features/interactions/interaction-knowledge';
import type {
  InteractionConclusion,
  InteractionPairResult,
  InteractionSeverity,
} from '@/features/interactions/interaction-types';

interface MedicationInteractionCheckerProps {
  readonly detectedMedicationNames?: readonly string[];
}

const CONCLUSION_LABELS: Readonly<Record<InteractionConclusion, string>> = {
  contraindicated: 'Противопоказано',
  avoid: 'Избегать сочетания',
  'management-required': 'Требуется изменение тактики',
  monitor: 'Требуется наблюдение',
  'separate-administration': 'Разнести приём',
  'documented-minor': 'Документированное слабое взаимодействие',
  'documented-no-significant-interaction': 'Значимое взаимодействие не выявлено',
  'potential-mechanistic-interaction': 'Потенциальное механистическое взаимодействие',
  'conflicting-evidence': 'Требуется ручная сверка',
  unknown: 'Данные не подтверждены',
};

const SEVERITY_LABELS: Readonly<Record<InteractionSeverity, string>> = {
  critical: 'Критическая значимость',
  high: 'Высокая значимость',
  moderate: 'Умеренная значимость',
  low: 'Низкая значимость',
  none: 'Значимость не выявлена',
  unknown: 'Значимость неизвестна',
};

function inputItems(value: string): readonly string[] {
  const direct = value
    .split(/[,;\n+]|\s+и\s+/giu)
    .map((item) => item.trim())
    .filter(Boolean);
  const extracted = extractMedicationNames(value, MEDICATION_INTERACTION_KNOWLEDGE);
  return extracted.length >= 2 ? extracted : direct;
}

function InteractionResultCard(props: { readonly pair: InteractionPairResult }): JSX.Element {
  return (
    <article
      class="interaction-result-card paper-card"
      data-conclusion={props.pair.conclusion}
      data-severity={props.pair.severity}
    >
      <header>
        <div>
          <p class="archive-kicker">{SEVERITY_LABELS[props.pair.severity]}</p>
          <h3>
            {props.pair.left.label} + {props.pair.right.label}
          </h3>
        </div>
        <strong>{CONCLUSION_LABELS[props.pair.conclusion]}</strong>
      </header>

      <Show
        when={props.pair.conclusion !== 'unknown'}
        fallback={<p>{props.pair.recommendation}</p>}
      >
        <dl class="interaction-details">
          <Show when={props.pair.effect}>
            {(effect) => (
              <div>
                <dt>Клинический эффект</dt>
                <dd>{effect()}</dd>
              </div>
            )}
          </Show>
          <Show when={props.pair.mechanism}>
            {(mechanism) => (
              <div>
                <dt>Механизм</dt>
                <dd>{mechanism()}</dd>
              </div>
            )}
          </Show>
          <div>
            <dt>Действие</dt>
            <dd>{props.pair.recommendation}</dd>
          </div>
        </dl>
      </Show>

      <Show when={props.pair.evidence.length > 0}>
        <details>
          <summary>Подтверждающие источники</summary>
          <For each={props.pair.evidence}>
            {(evidence) => (
              <blockquote>
                <p>«{evidence.quote}»</p>
                <cite>
                  <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">
                    {evidence.sourceTitle}
                  </a>
                  <span>
                    {evidence.issuer} · юрисдикция: {evidence.jurisdiction}
                  </span>
                  <span>
                    {evidence.sourceVersion} · проверено {evidence.reviewedAt}
                  </span>
                </cite>
              </blockquote>
            )}
          </For>
        </details>
      </Show>
    </article>
  );
}

export function MedicationInteractionChecker(
  props: MedicationInteractionCheckerProps,
): JSX.Element {
  const [value, setValue] = createSignal('');
  const [expanded, setExpanded] = createSignal(false);
  let lastDetected = '';

  createEffect(() => {
    const detected = props.detectedMedicationNames?.filter(Boolean) ?? [];
    const next = detected.join(', ');
    if (detected.length < 2 || next === lastDetected) return;
    lastDetected = next;
    setValue(next);
    setExpanded(true);
  });

  const items = createMemo(() => inputItems(value()));
  const result = createMemo(() =>
    checkMedicationInteractions(items(), MEDICATION_INTERACTION_KNOWLEDGE),
  );
  const hasEnoughMedications = createMemo(() => result().pairs.length > 0);

  const useExample = (example: string): void => {
    setValue(example);
    setExpanded(true);
  };

  return (
    <section class="interaction-checker paper-card" aria-label="Проверка взаимодействий">
      <header class="interaction-checker-heading">
        <div class="interaction-checker-icon">
          <AppGlyph name="graph" />
        </div>
        <div>
          <p class="archive-kicker">Клиническая фармакология · пилот</p>
          <h2>Проверка взаимодействий препаратов</h2>
          <p>
            Проверяются только рецензированные связи. Отсутствие связи означает недостаток данных,
            а не доказанную совместимость.
          </p>
        </div>
        <button
          type="button"
          aria-expanded={expanded()}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded() ? 'Свернуть' : 'Открыть'}
        </button>
      </header>

      <Show when={expanded()}>
        <div class="interaction-checker-body">
          <label>
            <span>Препараты через запятую или с новой строки</span>
            <textarea
              rows="3"
              value={value()}
              placeholder="Например: эсциталопрам, фосфомицин"
              onInput={(event) => setValue(event.currentTarget.value)}
            />
          </label>

          <div class="interaction-examples" aria-label="Примеры проверок">
            <button type="button" onClick={() => useExample('эсциталопрам, фосфомицин')}>
              Эсциталопрам + фосфомицин
            </button>
            <button type="button" onClick={() => useExample('эсциталопрам, линезолид')}>
              Эсциталопрам + линезолид
            </button>
            <button type="button" onClick={() => useExample('фосфомицин, метоклопрамид')}>
              Фосфомицин + метоклопрамид
            </button>
          </div>

          <Show when={result().resolved.length > 0}>
            <div class="interaction-recognized">
              <span>Распознано:</span>
              <For each={result().resolved}>
                {(item) => <strong>{item.concept.preferredName}</strong>}
              </For>
            </div>
          </Show>

          <Show when={result().unresolved.length > 0}>
            <div class="interaction-unresolved" role="status">
              Не удалось однозначно распознать:{' '}
              {result()
                .unresolved.map((item) => item.input)
                .join(', ')}
              . Пары с этими названиями помечены как непроверенные.
            </div>
          </Show>

          <Show when={result().duplicateInputs.length > 0}>
            <div class="interaction-unresolved" role="status">
              Повторные названия исключены:{' '}
              {result().duplicateInputs.join(', ')}
            </div>
          </Show>

          <Show when={result().truncated}>
            <div class="interaction-unresolved" role="status">
              За одну проверку обрабатываются первые 20 уникальных препаратов.
            </div>
          </Show>

          <Show
            when={hasEnoughMedications()}
            fallback={<p class="interaction-empty">Укажите как минимум два названия препаратов.</p>}
          >
            <div class="interaction-result-list">
              <For each={result().pairs}>
                {(pair) => <InteractionResultCard pair={pair} />}
              </For>
            </div>
          </Show>

          <p class="interaction-disclaimer">
            Проверка не учитывает дозы, путь введения, функцию почек и печени, электролиты,
            беременность и другие индивидуальные факторы. Зарубежная маркировка показана с её
            юрисдикцией и не заменяет актуальную российскую инструкцию. Проверка не заменяет
            клиническое решение.
          </p>
        </div>
      </Show>
    </section>
  );
}
