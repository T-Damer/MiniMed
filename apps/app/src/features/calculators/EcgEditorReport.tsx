import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { PrintManager } from '@/features/printing/print-manager';
import reportStyles from '@/styles/ecg-editor-report.css?inline';
import { ECG_STANDARD_LEADS } from './ecg-model-contract';
import { ECG_PEDIATRIC_NORM_GROUPS, ECG_PEDIATRIC_UNCOVERED } from './ecg-pediatric-norms';
import type { EcgMeasurements } from './ecg-photo-caliper';
import { interpretAdultEcgMeasurements } from './ecg-photo-interpreter';
import { ECG_ST_CRITERIA } from './ecg-st-criteria';
import { ecgRegionLabel } from './ecgEditor';
import type { EcgEditor, EcgEditorAgeBand } from './useEcgEditor';

const PEDIATRIC_GROUPS = [
  ECG_PEDIATRIC_UNCOVERED[0],
  ...ECG_PEDIATRIC_NORM_GROUPS,
  ECG_PEDIATRIC_UNCOVERED[1],
] as const;

const AGE_BANDS: readonly { readonly value: EcgEditorAgeBand; readonly label: string }[] = [
  { value: 'unknown', label: 'Не указан' },
  { value: 'adult-under-40', label: '18–39 лет' },
  { value: 'adult-40-plus', label: '40 лет и старше' },
  { value: 'pediatric', label: 'Младше 18 лет' },
];

import '@/styles/ecg-editor-report.css';

const METRICS: readonly {
  readonly key: keyof EcgMeasurements;
  readonly label: string;
  readonly unit: string;
}[] = [
  { key: 'rrMs', label: 'RR', unit: 'мс' },
  { key: 'heartRate', label: 'ЧСС', unit: '/мин' },
  { key: 'pDurationMs', label: 'P', unit: 'мс' },
  { key: 'prMs', label: 'PR', unit: 'мс' },
  { key: 'qrsMs', label: 'QRS', unit: 'мс' },
  { key: 'qtMs', label: 'QT', unit: 'мс' },
  { key: 'qtcFridericiaMs', label: 'QTc Fridericia', unit: 'мс' },
  { key: 'qtcBazettMs', label: 'QTc Bazett', unit: 'мс' },
  { key: 'qtcFraminghamMs', label: 'QTc Framingham', unit: 'мс' },
];

export function EcgEditorReport(props: {
  readonly editor: EcgEditor;
  readonly onOpenNumeric: () => void;
}): JSX.Element {
  const e = props.editor;
  const [error, setError] = createSignal('');
  let paper: HTMLElement | undefined;
  let preview: HTMLDivElement | undefined;
  const [scale, setScale] = createSignal(1);
  onMount(() => {
    if (!paper || !preview) return;
    const resize = new ResizeObserver(() => {
      if (paper && preview)
        setScale(
          Math.min(
            1,
            preview.clientWidth / paper.offsetWidth,
            preview.clientHeight / paper.offsetHeight,
          ),
        );
    });
    resize.observe(paper);
    resize.observe(preview);
    onCleanup(() => resize.disconnect());
  });
  const interpretation = createMemo(() =>
    e.patientRoute() === 'adult' && e.completed().every(Boolean)
      ? interpretAdultEcgMeasurements({
          measurements: e.measurement().measurements,
          sex: e.sex() ?? 'unknown',
        })
      : undefined,
  );
  const pointOrigin = createMemo(() => {
    const points = e.draft().points.filter((p) => p.regionId === e.measurementRegion());
    const auto = points.filter((p) => p.source === 'auto').length;
    return { auto, manual: points.length - auto };
  });
  const measuredLead = () => {
    const region = e.draft().regions.find((r) => r.id === e.measurementRegion());
    return region ? ecgRegionLabel(region) : '—';
  };
  const print = (): void => {
    if (!paper || !e.completed().every(Boolean)) return;
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Измерения ЭКГ — MiniMed</title><style>${reportStyles}</style></head><body class="ecg-report-print">${paper.outerHTML.replace(/ style="[^"]*"/, '')}</body></html>`;
    setError(
      PrintManager.html(html, 'Измерения ЭКГ — MiniMed')
        ? ''
        : 'Не удалось открыть печать. Разрешите всплывающее окно и повторите.',
    );
  };
  return (
    <div class="ecg-editor__report-view">
      <div class="ecg-editor__patient">
        <label class="ecg-editor__field">
          Возраст
          <select
            class="ecg-editor__select"
            classList={{ 'ecg-editor__select--required': e.ageBand() === 'unknown' }}
            value={e.ageBand()}
            onChange={(event) => {
              const next = AGE_BANDS.find((band) => band.value === event.currentTarget.value);
              if (next) e.setAgeBand(next.value);
            }}
          >
            <For each={AGE_BANDS}>
              {(band) => (
                <option value={band.value} selected={band.value === e.ageBand()}>
                  {band.label}
                </option>
              )}
            </For>
          </select>
        </label>
        <Show when={e.ageBand() === 'pediatric'}>
          <label class="ecg-editor__field">
            Возрастная группа
            <select
              class="ecg-editor__select"
              classList={{ 'ecg-editor__select--required': !e.pediatricGroup() }}
              value={e.pediatricGroup() ?? ''}
              onChange={(event) => {
                const next = PEDIATRIC_GROUPS.find(
                  (group) => group.id === event.currentTarget.value,
                );
                if (next) e.setPediatricGroup(next.id);
              }}
            >
              <option value="" disabled>
                Выберите
              </option>
              <For each={PEDIATRIC_GROUPS}>
                {(group) => (
                  <option value={group.id} selected={group.id === e.pediatricGroup()}>
                    {group.label}
                  </option>
                )}
              </For>
            </select>
          </label>
        </Show>
        <label class="ecg-editor__field">
          Пол для QTc и ST
          <select
            class="ecg-editor__select"
            value={e.sex() ?? 'unknown'}
            onChange={(event) => {
              const value = event.currentTarget.value;
              e.setSex(value === 'male' || value === 'female' ? value : 'unknown');
            }}
          >
            <option value="unknown">Не указан</option>
            <option value="male">Мужской</option>
            <option value="female">Женский</option>
          </select>
        </label>
      </div>
      <div class="ecg-editor__report-actions">
        <span class="ecg-editor__hint">
          Один лист A4 · исходное фото и подтверждённые измерения
        </span>
        <div class="ecg-editor__report-buttons">
          <button
            class="ecg-editor__button"
            type="button"
            disabled={!e.numericDraft()}
            onClick={props.onOpenNumeric}
          >
            <AppGlyph class="ecg-editor__icon" name="calculator" />
            30 признаков для модели
          </button>
          <button
            class="ecg-editor__button ecg-editor__button--primary"
            type="button"
            onClick={print}
          >
            <AppGlyph class="ecg-editor__icon" name="printer" />
            Распечатать
          </button>
        </div>
      </div>
      <Show when={error()}>
        <p class="ecg-editor__error" role="alert">
          {error()}
        </p>
      </Show>
      <div class="ecg-editor__paper-preview" ref={preview}>
        <article class="ecg-report" ref={paper} style={{ zoom: scale() }}>
          <header class="ecg-report__header">
            <h2 class="ecg-report__title">ЭКГ · измерения и заключение</h2>
            <span class="ecg-report__brand">MiniMed</span>
          </header>
          <img
            class="ecg-report__image"
            src={e.photo()?.url}
            alt="ЭКГ, по которой выполнены измерения"
          />
          <p class="ecg-report__profile">
            {e.rectified() ? 'снимок выпрямлен по 4 углам · ' : ''}
            {e.draft().calibration.speed} мм/с · {e.draft().calibration.gain} мм/мВ · отведение{' '}
            {measuredLead()} ·{' '}
            {e.ageBand() === 'unknown'
              ? 'возраст не указан'
              : AGE_BANDS.find((band) => band.value === e.ageBand())?.label.toLowerCase()}{' '}
            ·{' '}
            {e.sex() === 'male'
              ? 'мужской пол'
              : e.sex() === 'female'
                ? 'женский пол'
                : 'пол не указан'}
          </p>
          <dl class="ecg-report__metrics">
            <For each={METRICS}>
              {(metric) => (
                <div class="ecg-report__metric">
                  <dt class="ecg-report__metric-label">{metric.label}</dt>
                  <dd class="ecg-report__metric-value">
                    {e.measurement().measurements[metric.key] ?? '—'}
                    <span class="ecg-report__unit"> {metric.unit}</span>
                  </dd>
                </div>
              )}
            </For>
            <Show when={e.measurement().rAmplitudeMv !== undefined}>
              <div class="ecg-report__metric">
                <dt class="ecg-report__metric-label">Амплитуда R</dt>
                <dd class="ecg-report__metric-value">
                  {e.measurement().rAmplitudeMv?.toFixed(2)}
                  <span class="ecg-report__unit"> мВ</span>
                </dd>
              </div>
            </Show>
          </dl>
          <Show when={e.stMeasurement()}>
            {(st) => (
              <section class="ecg-report__st">
                <h3 class="ecg-report__heading">{ECG_ST_CRITERIA.measurement.heading}</h3>
                <dl class="ecg-report__st-grid">
                  <For each={ECG_STANDARD_LEADS}>
                    {(lead) => {
                      const value = () => st().leads.find((item) => item.lead === lead)?.stMv;
                      return (
                        <div class="ecg-report__st-cell">
                          <dt class="ecg-report__metric-label">{lead}</dt>
                          <dd class="ecg-report__metric-value">
                            {value() === undefined
                              ? '—'
                              : ((value() ?? 0) * 10).toFixed(1).replace('.', ',')}
                          </dd>
                        </div>
                      );
                    }}
                  </For>
                </dl>
              </section>
            )}
          </Show>
          <section class="ecg-report__conclusion">
            <h3 class="ecg-report__heading">Предположительное заключение</h3>
            <Show
              when={interpretation()}
              fallback={
                <Show
                  when={e.pediatricEvaluation()}
                  fallback={
                    <p class="ecg-report__text">
                      {e.ageBand() === 'pediatric'
                        ? 'Выберите возрастную группу ребёнка: детские нормы зависят от возраста.'
                        : 'Показаны только измерения. Для применения взрослых правил необходимо подтвердить возраст 18 лет и старше.'}
                    </p>
                  }
                >
                  {(pediatric) => {
                    const covered = () => {
                      const evaluation = pediatric();
                      return evaluation.covered ? evaluation : undefined;
                    };
                    const uncovered = () => {
                      const evaluation = pediatric();
                      return evaluation.covered ? undefined : evaluation;
                    };
                    return (
                      <>
                        <Show when={covered()}>
                          {(evaluation) => (
                            <>
                              <ul class="ecg-report__findings">
                                <For
                                  each={evaluation().flags.filter(
                                    (flag) => flag.status !== 'within',
                                  )}
                                >
                                  {(flag) => <li class="ecg-report__finding">{flag.text}</li>}
                                </For>
                              </ul>
                              <p class="ecg-report__text">
                                {evaluation().flags.some((flag) => flag.status === 'within')
                                  ? `В пределах норм: ${evaluation()
                                      .flags.filter((flag) => flag.status === 'within')
                                      .map((flag) => flag.label)
                                      .join(', ')}. `
                                  : ''}
                                {evaluation().missing.length
                                  ? `Не измерено: ${evaluation().missing.join(', ')}. `
                                  : ''}
                                {evaluation().note} Источник: {evaluation().source}.
                              </p>
                            </>
                          )}
                        </Show>
                        <Show when={uncovered()}>
                          {(evaluation) => (
                            <p class="ecg-report__text">
                              {evaluation().text} Источник: {evaluation().source}.
                            </p>
                          )}
                        </Show>
                      </>
                    );
                  }}
                </Show>
              }
            >
              {(result) => (
                <>
                  <ul class="ecg-report__findings">
                    <For each={result().findings}>
                      {(finding) => (
                        <li
                          class="ecg-report__finding"
                          classList={{
                            'ecg-report__finding--urgent': finding.severity === 'urgent',
                          }}
                        >
                          {finding.text}
                        </li>
                      )}
                    </For>
                  </ul>
                  <Show when={e.stEvaluation()}>
                    {(st) => (
                      <>
                        <ul class="ecg-report__findings">
                          <For each={st().findings}>
                            {(finding) => (
                              <li
                                class="ecg-report__finding"
                                classList={{
                                  'ecg-report__finding--urgent': finding.severity === 'urgent',
                                }}
                              >
                                {finding.text}
                              </li>
                            )}
                          </For>
                        </ul>
                        <p class="ecg-report__text">
                          {st().scope} Источники:{' '}
                          {st()
                            .sources.map((source) => `${source.label} — ${source.citation}`)
                            .join('; ')}
                          .
                        </p>
                      </>
                    )}
                  </Show>
                  <Show when={result().missingData.length}>
                    <p class="ecg-report__text">
                      Не измерено:{' '}
                      {result()
                        .missingData.map((item) => item.id.toUpperCase())
                        .join(', ')}
                      . Отсутствие этих данных не означает норму.
                    </p>
                  </Show>
                </>
              )}
            </Show>
          </section>
          <p class="ecg-report__text">
            Точки отведения {measuredLead()}: {pointOrigin().auto} предложены авторазметкой и
            подтверждены без изменений, {pointOrigin().manual} поставлены или исправлены вручную.
          </p>
          <footer class="ecg-report__footer">
            Полумануальные измерения по фотографии, проверенные пользователем. Интервалы относятся к
            выбранному отведению; это не глобальные интервалы по 12 отведениям. Заключение требует
            врачебной оценки и не заменяет полную расшифровку ЭКГ.
          </footer>
        </article>
      </div>
    </div>
  );
}
