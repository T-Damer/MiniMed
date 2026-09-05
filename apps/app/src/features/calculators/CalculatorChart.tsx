import type { Chart as ChartInstance, Plugin } from 'chart.js';
import ChartJs from 'chart.js/auto';
import { createEffect, onCleanup, onMount } from 'solid-js';
import type { CalculationChartSpec } from '@/features/calculators/clinical-calculations';

const CHART_TONES = {
  neutral: '#667085',
  danger: '#d94f64',
  warning: '#e68a3f',
  success: '#27835c',
  accent: '#2f6fb0',
} as const;

/**
 * Renders a serializable chart spec produced by a schema visual. The spec is data (evaluated by the
 * calculation engine), so this component never executes calculator logic — it only draws.
 */
export function Chart(props: {
  readonly title: string;
  readonly spec: CalculationChartSpec;
  readonly heightPx?: number;
}) {
  let canvas: HTMLCanvasElement | undefined;

  const chartTitle = (): string => props.spec.title ?? props.title;
  const buildData = () => ({
    labels: [...props.spec.labels],
    datasets: props.spec.datasets.map((dataset) => {
      const color = CHART_TONES[dataset.tone ?? 'neutral'];
      return {
        label: dataset.label,
        data: [...dataset.data],
        ...(dataset.render || dataset.tone
          ? {
              borderColor: color,
              backgroundColor: color,
              borderWidth: dataset.tone === 'success' ? 2.5 : 1.5,
              pointBackgroundColor: color,
              pointBorderColor: '#ffffff',
              pointBorderWidth: dataset.render === 'point' ? 2 : 0,
              pointRadius: dataset.render === 'point' ? 6 : 0,
              pointHoverRadius: dataset.render === 'point' ? 8 : 4,
              showLine: dataset.render !== 'point',
              tension: 0.18,
            }
          : {}),
      };
    }),
  });

  onMount(() => {
    if (!canvas) return;
    const theme = getComputedStyle(document.documentElement);
    const textColor = theme.getPropertyValue('--theme-text').trim() || '#4b5563';
    const mutedColor = theme.getPropertyValue('--theme-text-muted').trim() || '#667085';
    const gridColor = theme.getPropertyValue('--theme-border').trim() || 'rgba(127, 127, 127, 0.2)';
    const drawAnnotations = (chart: ChartInstance): void => {
      const { x: xScale, y: yScale } = chart.scales;
      if (!xScale || !yScale) return;
      const context = chart.ctx;
      const { left, right, top, bottom, width, height } = chart.chartArea;
      context.save();
      for (const annotation of props.spec.annotations ?? []) {
        const x = xScale.getPixelForValue(annotation.x);
        const y = yScale.getPixelForValue(annotation.y);
        if (annotation.kind === 'rings') {
          context.strokeStyle = gridColor;
          context.setLineDash([2, 5]);
          for (const radius of annotation.radiusPercent) {
            context.beginPath();
            context.arc(x, y, (Math.min(width, height) * radius) / 100, 0, Math.PI * 2);
            context.stroke();
          }
          context.setLineDash([]);
          continue;
        }
        context.fillStyle = textColor;
        context.font = '700 13px system-ui, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const labels = annotation.labels;
        context.fillText(labels.topLeft, (left + x) / 2, (top + y) / 2);
        context.fillText(labels.topRight, (x + right) / 2, (top + y) / 2);
        context.fillText(labels.bottomLeft, (left + x) / 2, (y + bottom) / 2);
        context.fillText(labels.bottomRight, (x + right) / 2, (y + bottom) / 2);
      }
      context.restore();
    };
    const annotationPlugin: Plugin = {
      id: 'schema-annotations',
      beforeDatasetsDraw: drawAnnotations,
    };
    let lastSerialized = JSON.stringify(buildData()) + chartTitle();
    const chart = new ChartJs(canvas, {
      type: props.spec.type,
      data: buildData(),
      plugins: [annotationPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        color: mutedColor,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          ...(props.spec.xAxis
            ? {
                x: {
                  type: 'linear' as const,
                  min: props.spec.xAxis.minimum,
                  max: props.spec.xAxis.maximum,
                  reverse: props.spec.xAxis.reverse,
                  title: { display: true, text: props.spec.xAxis.label },
                  ticks: {
                    color: mutedColor,
                    callback: (value) => {
                      if (value === props.spec.xAxis?.minimum) {
                        return props.spec.xAxis.minimumLabel ?? String(value);
                      }
                      if (value === props.spec.xAxis?.maximum) {
                        return props.spec.xAxis.maximumLabel ?? String(value);
                      }
                      return String(value);
                    },
                  },
                  grid: { color: gridColor },
                },
              }
            : {}),
          ...(props.spec.yAxis
            ? {
                y: {
                  min: props.spec.yAxis.minimum,
                  max: props.spec.yAxis.maximum,
                  reverse: props.spec.yAxis.reverse,
                  title: { display: true, text: props.spec.yAxis.label },
                  ticks: {
                    color: mutedColor,
                    callback: (value) => {
                      if (value === props.spec.yAxis?.minimum) {
                        return props.spec.yAxis.minimumLabel ?? String(value);
                      }
                      if (value === props.spec.yAxis?.maximum) {
                        return props.spec.yAxis.maximumLabel ?? String(value);
                      }
                      return String(value);
                    },
                  },
                  grid: { color: gridColor },
                },
              }
            : {}),
        },
        plugins: {
          title: {
            display: true,
            text: chartTitle(),
            color: textColor,
            font: { size: 15, weight: 700 },
            padding: { bottom: 14 },
          },
          legend: {
            display:
              props.spec.datasets.length > 1 ||
              props.spec.type === 'pie' ||
              props.spec.type === 'doughnut',
            position: 'bottom',
            labels: { color: mutedColor, usePointStyle: true, boxWidth: 10, padding: 14 },
          },
        },
      },
    });

    createEffect(() => {
      const serialized = JSON.stringify(buildData()) + chartTitle();
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      chart.data = buildData();
      chart.update();
    });

    onCleanup(() => chart.destroy());
  });

  return (
    <figure class="calculator-chart">
      <div class="calculator-chart__canvas-wrap" style={{ height: `${props.heightPx ?? 320}px` }}>
        <canvas
          class="calculator-chart__canvas"
          ref={canvas}
          role="img"
          aria-label={chartTitle()}
        />
      </div>
      {props.spec.caption ? (
        <figcaption class="calculator-chart__caption">{props.spec.caption}</figcaption>
      ) : null}
    </figure>
  );
}

export const CalculatorChart = Chart;
