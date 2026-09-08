import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from 'solid-js';
import { AppGlyph } from '@/components/AppGlyph';
import { PrintManager } from '@/features/printing/print-manager';
import reportStyles from '@/styles/ecg-editor-report.css?inline';
import type { EcgMeasurements } from './ecg-photo-caliper';
import { interpretAdultEcgMeasurements } from './ecg-photo-interpreter';
import { ecgRegionLabel } from './ecgEditor';
import type { EcgEditor } from './useEcgEditor';
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

export function EcgEditorReport(props: { readonly editor: EcgEditor }): JSX.Element {
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
      <div class="ecg-editor__report-actions">
        <span class="ecg-editor__hint">
          Один лист A4 · исходное фото и подтверждённые измерения
        </span>
        <button
          class="ecg-editor__button ecg-editor__button--primary"
          type="button"
          onClick={print}
        >
          <AppGlyph class="ecg-editor__icon" name="printer" />
          Распечатать
        </button>
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
            {e.draft().calibration.speed} мм/с · {e.draft().calibration.gain} мм/мВ · отведение{' '}
            {measuredLead()} ·{' '}
            {e.patientRoute() === 'adult'
              ? '18 лет и старше'
              : e.patientRoute() === 'pediatric'
                ? 'младше 18 лет'
                : 'возраст не указан'}{' '}
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
          <section class="ecg-report__conclusion">
            <h3 class="ecg-report__heading">Предположительное заключение</h3>
            <Show
              when={interpretation()}
              fallback={
                <p class="ecg-report__text">
                  Показаны только измерения. Для применения взрослых правил необходимо подтвердить
                  возраст 18 лет и старше.
                </p>
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
